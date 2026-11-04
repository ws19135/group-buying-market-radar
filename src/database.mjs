import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NORMALIZATION_VERSION,
  PARSER_VERSION,
  SCORE_VERSION,
  buildEvidence,
  buildPromotionDraft,
  executeDryRun,
  findMatchCandidates,
  newId,
  normalizeKey,
  normalizeObservation,
  nowIso,
  observationFingerprint,
  scoreKol,
  scoreVendor,
  sha256,
} from "./domain.mjs";

function fromJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function mapObservation(row) {
  if (!row) return null;
  return {
    ...row,
    official_end_date: Boolean(row.official_end_date),
    raw_payload: fromJson(row.raw_payload_json, {}),
    normalized: fromJson(row.normalized_json, {}),
  };
}

function mapLead(row) {
  if (!row) return null;
  return {
    ...row,
    score_breakdown: fromJson(row.score_breakdown_json, {}),
    source_observation_ids: fromJson(row.source_observation_ids_json, []),
    metadata: fromJson(row.metadata_json, {}),
  };
}

function mapPromotion(row) {
  if (!row) return null;
  return {
    ...row,
    proposed_fields: fromJson(row.proposed_fields_json, {}),
    evidence: fromJson(row.evidence_json, []),
    match_candidates: fromJson(row.match_candidates_json, []),
    dry_run_result: fromJson(row.dry_run_result_json, null),
  };
}

export class RadarDatabase {
  constructor(filename = ":memory:") {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  close() {
    this.db.close();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sources (
        source_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        base_url TEXT NOT NULL UNIQUE,
        policy_status TEXT NOT NULL DEFAULT 'PENDING',
        health_status TEXT NOT NULL DEFAULT 'UNKNOWN',
        scrape_allowed INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        parser_version TEXT NOT NULL,
        last_success_at TEXT,
        last_error_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collection_runs (
        run_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(source_id),
        status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_count INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        errors_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS observations (
        observation_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(source_id),
        source_url TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        title TEXT NOT NULL,
        brand TEXT,
        product_name TEXT,
        vendor_name TEXT,
        host_name TEXT,
        platform TEXT,
        platform_handle TEXT,
        category TEXT,
        public_email TEXT,
        starts_at TEXT,
        ends_at TEXT,
        official_end_date INTEGER NOT NULL DEFAULT 0,
        price_amount REAL,
        currency TEXT,
        notes TEXT,
        raw_payload_json TEXT NOT NULL,
        raw_payload_hash TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        parser_version TEXT NOT NULL,
        normalization_version TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        confidence REAL,
        status TEXT NOT NULL DEFAULT 'OBSERVED',
        normalized_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(entity_type);
      CREATE INDEX IF NOT EXISTS idx_observations_status ON observations(status);
      CREATE INDEX IF NOT EXISTS idx_observations_observed ON observations(observed_at DESC);
      CREATE TABLE IF NOT EXISTS evidence (
        evidence_id TEXT PRIMARY KEY,
        observation_id TEXT NOT NULL REFERENCES observations(observation_id),
        field TEXT NOT NULL,
        raw_value TEXT NOT NULL,
        source_url TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_evidence_observation ON evidence(observation_id);
      CREATE TABLE IF NOT EXISTS match_candidates (
        candidate_id TEXT PRIMARY KEY,
        observation_id TEXT NOT NULL REFERENCES observations(observation_id),
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        confidence REAL NOT NULL,
        reasons_json TEXT NOT NULL,
        conflicts_json TEXT NOT NULL,
        status TEXT NOT NULL,
        reviewed_by TEXT,
        reviewed_at TEXT,
        version TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leads (
        lead_id TEXT PRIMARY KEY,
        lead_type TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        normalized_key TEXT NOT NULL,
        score INTEGER NOT NULL,
        score_version TEXT NOT NULL,
        score_breakdown_json TEXT NOT NULL,
        data_sufficiency INTEGER NOT NULL,
        stage TEXT NOT NULL,
        last_observed_at TEXT NOT NULL,
        source_observation_ids_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(lead_type, normalized_key)
      );
      CREATE INDEX IF NOT EXISTS idx_leads_type_stage ON leads(lead_type, stage);
      CREATE TABLE IF NOT EXISTS review_decisions (
        decision_id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL REFERENCES leads(lead_id),
        actor_role TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT NOT NULL,
        before_status TEXT NOT NULL,
        after_status TEXT NOT NULL,
        decided_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS promotion_drafts (
        promotion_draft_id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL REFERENCES leads(lead_id),
        target_type TEXT NOT NULL,
        contract_version TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        proposed_fields_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        match_candidates_json TEXT NOT NULL,
        requested_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        dry_run_result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        audit_id TEXT PRIMARY KEY,
        actor_role TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        request_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES ('001_initial_mvp', datetime('now'));
    `);
  }

  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  audit({ actorRole = "SYSTEM", action, entityType, entityId, before = null, after = null, requestId = newId("req") }) {
    const row = {
      audit_id: newId("audit"), actor_role: actorRole, action, entity_type: entityType,
      entity_id: entityId, before_json: toJson(before), after_json: toJson(after),
      request_id: requestId, created_at: nowIso(),
    };
    this.db.prepare(`INSERT INTO audit_log VALUES (@audit_id,@actor_role,@action,@entity_type,@entity_id,@before_json,@after_json,@request_id,@created_at)`).run(row);
    return row;
  }

  createSource(input, context = {}) {
    const timestamp = nowIso();
    const baseUrl = input.base_url;
    const row = {
      source_id: input.source_id || newId("src"),
      name: input.name || new URL(baseUrl).hostname,
      type: input.type || "MANUAL_URL",
      base_url: baseUrl,
      policy_status: input.policy_status || "PENDING",
      health_status: input.health_status || "UNKNOWN",
      scrape_allowed: input.scrape_allowed ? 1 : 0,
      active: input.active === false ? 0 : 1,
      parser_version: input.parser_version || PARSER_VERSION,
      created_at: timestamp,
      updated_at: timestamp,
    };
    const existing = this.db.prepare("SELECT * FROM sources WHERE base_url = ?").get(baseUrl);
    if (existing) return { created: false, source: this.mapSource(existing) };
    this.db.prepare(`INSERT INTO sources(source_id,name,type,base_url,policy_status,health_status,scrape_allowed,active,parser_version,created_at,updated_at)
      VALUES (@source_id,@name,@type,@base_url,@policy_status,@health_status,@scrape_allowed,@active,@parser_version,@created_at,@updated_at)`).run(row);
    const source = this.mapSource(row);
    this.audit({ actorRole: context.actorRole, action: "SOURCE_CREATED", entityType: "SOURCE", entityId: row.source_id, after: source, requestId: context.requestId });
    return { created: true, source };
  }

  mapSource(row) {
    return { ...row, scrape_allowed: Boolean(row.scrape_allowed), active: Boolean(row.active) };
  }

  listSources() {
    return this.db.prepare("SELECT * FROM sources ORDER BY active DESC, updated_at DESC").all().map(row => this.mapSource(row));
  }

  ensureManualSource(sourceUrl, context = {}) {
    const url = new URL(sourceUrl);
    const baseUrl = `${url.protocol}//${url.host}/`;
    return this.createSource({ name: `人工提交：${url.hostname}`, type: "MANUAL_URL", base_url: baseUrl, policy_status: "MANUAL_REVIEW", health_status: "HEALTHY" }, context).source;
  }

  createObservation(input, context = {}) {
    const normalized = normalizeObservation(input);
    const source = input.source_id
      ? this.db.prepare("SELECT * FROM sources WHERE source_id = ?").get(input.source_id)
      : this.ensureManualSource(normalized.source_url, context);
    if (!source) throw Object.assign(new Error("找不到資料來源"), { status: 404, code: "SOURCE_NOT_FOUND" });
    const fingerprint = observationFingerprint(normalized);
    const duplicate = this.db.prepare("SELECT * FROM observations WHERE fingerprint = ?").get(fingerprint);
    if (duplicate) return { created: false, duplicate: true, observation: mapObservation(duplicate), matches: [] };
    const timestamp = input.observed_at || nowIso();
    const observationId = input.observation_id || newId("obs");
    const rawPayload = input.raw_payload || input;
    const row = {
      observation_id: observationId,
      source_id: source.source_id,
      ...normalized,
      official_end_date: normalized.official_end_date ? 1 : 0,
      raw_payload_json: toJson(rawPayload),
      raw_payload_hash: sha256(rawPayload),
      fingerprint,
      parser_version: input.parser_version || PARSER_VERSION,
      normalization_version: NORMALIZATION_VERSION,
      observed_at: timestamp,
      confidence: input.confidence ?? null,
      status: input.status || "OBSERVED",
      normalized_json: toJson(normalized),
      created_at: nowIso(),
    };
    const existing = this.listObservations({ pageSize: 10_000 }).items;
    const matches = findMatchCandidates({ ...row, official_end_date: Boolean(row.official_end_date) }, existing);
    this.transaction(() => {
      this.db.prepare(`INSERT INTO observations(
        observation_id,source_id,source_url,entity_type,title,brand,product_name,vendor_name,host_name,platform,platform_handle,category,public_email,starts_at,ends_at,official_end_date,price_amount,currency,notes,raw_payload_json,raw_payload_hash,fingerprint,parser_version,normalization_version,observed_at,confidence,status,normalized_json,created_at
      ) VALUES (
        @observation_id,@source_id,@source_url,@entity_type,@title,@brand,@product_name,@vendor_name,@host_name,@platform,@platform_handle,@category,@public_email,@starts_at,@ends_at,@official_end_date,@price_amount,@currency,@notes,@raw_payload_json,@raw_payload_hash,@fingerprint,@parser_version,@normalization_version,@observed_at,@confidence,@status,@normalized_json,@created_at
      )`).run(row);
      const evidenceInsert = this.db.prepare("INSERT INTO evidence VALUES (@evidence_id,@observation_id,@field,@raw_value,@source_url,@captured_at)");
      for (const evidence of buildEvidence(observationId, normalized, timestamp)) evidenceInsert.run(evidence);
      const matchInsert = this.db.prepare(`INSERT INTO match_candidates(candidate_id,observation_id,target_type,target_id,confidence,reasons_json,conflicts_json,status,version)
        VALUES (@candidate_id,@observation_id,@target_type,@target_id,@confidence,@reasons_json,@conflicts_json,@status,@version)`);
      for (const match of matches) matchInsert.run({
        candidate_id: match.candidate_id,
        observation_id: match.observation_id,
        target_type: match.target_type,
        target_id: match.target_id,
        confidence: match.confidence,
        reasons_json: toJson(match.reasons),
        conflicts_json: toJson(match.conflicts),
        status: match.status,
        version: match.version,
      });
      this.audit({ actorRole: context.actorRole, action: "OBSERVATION_CREATED", entityType: "OBSERVATION", entityId: observationId, after: normalized, requestId: context.requestId });
    });
    return { created: true, duplicate: false, observation: mapObservation(row), matches };
  }

  importObservations(records, { sourceId, idempotencyKey, actorRole, requestId } = {}) {
    if (!Array.isArray(records) || !records.length) throw Object.assign(new Error("匯入內容沒有資料列"), { status: 400, code: "EMPTY_IMPORT" });
    const source = sourceId ? this.db.prepare("SELECT * FROM sources WHERE source_id = ?").get(sourceId) : null;
    if (sourceId && !source) throw Object.assign(new Error("找不到匯入來源"), { status: 404, code: "SOURCE_NOT_FOUND" });
    const runKey = idempotencyKey || sha256({ sourceId: sourceId || "MANUAL", records });
    const existingRun = this.db.prepare("SELECT * FROM collection_runs WHERE idempotency_key = ?").get(runKey);
    if (existingRun) return { replayed: true, run: { ...existingRun, errors: fromJson(existingRun.errors_json, []) } };
    const run = {
      run_id: newId("run"), source_id: sourceId || this.ensureManualSource(records[0].source_url || records[0].sourceUrl, { actorRole, requestId }).source_id,
      status: "RUNNING", idempotency_key: runKey, started_at: nowIso(), completed_at: null,
      created_count: 0, duplicate_count: 0, error_count: 0, errors_json: "[]",
    };
    this.db.prepare(`INSERT INTO collection_runs VALUES (@run_id,@source_id,@status,@idempotency_key,@started_at,@completed_at,@created_count,@duplicate_count,@error_count,@errors_json)`).run(run);
    const errors = [];
    for (let index = 0; index < records.length; index += 1) {
      try {
        const result = this.createObservation({ ...records[index], source_id: sourceId || undefined }, { actorRole, requestId });
        if (result.created) run.created_count += 1; else run.duplicate_count += 1;
      } catch (error) {
        run.error_count += 1;
        errors.push({ row: index + 1, code: error.code || "IMPORT_ROW_ERROR", message: error.message });
      }
    }
    run.status = run.error_count === records.length ? "FAILED" : run.error_count ? "PARTIAL" : "COMPLETED";
    run.completed_at = nowIso();
    run.errors_json = toJson(errors);
    this.db.prepare(`UPDATE collection_runs SET status=@status,completed_at=@completed_at,created_count=@created_count,duplicate_count=@duplicate_count,error_count=@error_count,errors_json=@errors_json WHERE run_id=@run_id`).run({
      run_id: run.run_id,
      status: run.status,
      completed_at: run.completed_at,
      created_count: run.created_count,
      duplicate_count: run.duplicate_count,
      error_count: run.error_count,
      errors_json: run.errors_json,
    });
    this.audit({ actorRole, action: "IMPORT_COMPLETED", entityType: "COLLECTION_RUN", entityId: run.run_id, after: { ...run, errors }, requestId });
    return { replayed: false, run: { ...run, errors } };
  }

  listObservations({ query = "", entityType = "", status = "", page = 1, pageSize = 50 } = {}) {
    const safePageSize = Math.max(1, Math.min(200, Number(pageSize) || 50));
    const safePage = Math.max(1, Number(page) || 1);
    const where = [];
    const params = {};
    if (query) { where.push("(title LIKE @query OR vendor_name LIKE @query OR host_name LIKE @query OR product_name LIKE @query OR source_url LIKE @query)"); params.query = `%${query}%`; }
    if (entityType) { where.push("entity_type = @entityType"); params.entityType = entityType; }
    if (status) { where.push("status = @status"); params.status = status; }
    const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = this.db.prepare(`SELECT COUNT(*) AS count FROM observations ${sqlWhere}`).get(params).count;
    const rows = this.db.prepare(`SELECT * FROM observations ${sqlWhere} ORDER BY observed_at DESC LIMIT @limit OFFSET @offset`).all({ ...params, limit: safePageSize, offset: (safePage - 1) * safePageSize });
    return { items: rows.map(mapObservation), total, page: safePage, page_size: safePageSize };
  }

  getObservation(id) {
    const row = this.db.prepare("SELECT * FROM observations WHERE observation_id = ?").get(id);
    if (!row) return null;
    return {
      ...mapObservation(row),
      evidence: this.db.prepare("SELECT * FROM evidence WHERE observation_id = ? ORDER BY captured_at").all(id),
      match_candidates: this.db.prepare("SELECT * FROM match_candidates WHERE observation_id = ? ORDER BY confidence DESC").all(id).map(item => ({ ...item, reasons: fromJson(item.reasons_json, []), conflicts: fromJson(item.conflicts_json, []) })),
    };
  }

  rebuildLeads(context = {}) {
    const observations = this.listObservations({ pageSize: 10_000 }).items;
    const evidenceCounts = new Map(this.db.prepare("SELECT observation_id, COUNT(*) AS count FROM evidence GROUP BY observation_id").all().map(row => [row.observation_id, row.count]));
    const groups = new Map();
    for (const observation of observations) {
      for (const [leadType, nameField] of [["VENDOR", "vendor_name"], ["KOL", "host_name"]]) {
        const name = observation[nameField];
        const key = normalizeKey(name);
        if (!key) continue;
        const groupKey = `${leadType}:${key}`;
        if (!groups.has(groupKey)) groups.set(groupKey, { lead_type: leadType, canonical_name: name, normalized_key: key, observations: [] });
        groups.get(groupKey).observations.push(observation);
      }
    }
    let created = 0;
    let updated = 0;
    for (const group of groups.values()) {
      const ordered = group.observations.sort((a, b) => b.observed_at.localeCompare(a.observed_at));
      const latest = ordered[0];
      const summary = {
        canonical_name: group.canonical_name,
        observation_count: ordered.length,
        evidence_count: ordered.reduce((sum, item) => sum + (evidenceCounts.get(item.observation_id) || 0), 0),
        category: ordered.find(item => item.category)?.category || null,
        public_email: ordered.find(item => item.public_email)?.public_email || null,
        platform: ordered.find(item => item.platform)?.platform || null,
        platform_handle: ordered.find(item => item.platform_handle)?.platform_handle || null,
        source_url: latest.source_url,
        last_observed_at: latest.observed_at,
      };
      const scored = group.lead_type === "VENDOR" ? scoreVendor(summary) : scoreKol(summary);
      const existing = this.db.prepare("SELECT * FROM leads WHERE lead_type = ? AND normalized_key = ?").get(group.lead_type, group.normalized_key);
      const timestamp = nowIso();
      const row = {
        lead_id: existing?.lead_id || `lead_${group.lead_type.toLowerCase()}_${sha256(group.normalized_key).slice(0, 20)}`,
        lead_type: group.lead_type,
        canonical_name: group.canonical_name,
        normalized_key: group.normalized_key,
        score: scored.score,
        score_version: SCORE_VERSION,
        score_breakdown_json: toJson(scored.breakdown),
        data_sufficiency: scored.data_sufficiency,
        stage: existing?.stage || "DISCOVERED",
        last_observed_at: latest.observed_at,
        source_observation_ids_json: toJson(ordered.map(item => item.observation_id)),
        metadata_json: toJson(summary),
        created_at: existing?.created_at || timestamp,
        updated_at: timestamp,
      };
      if (existing) {
        this.db.prepare(`UPDATE leads SET canonical_name=@canonical_name,score=@score,score_version=@score_version,score_breakdown_json=@score_breakdown_json,data_sufficiency=@data_sufficiency,last_observed_at=@last_observed_at,source_observation_ids_json=@source_observation_ids_json,metadata_json=@metadata_json,updated_at=@updated_at WHERE lead_id=@lead_id`).run({
          lead_id: row.lead_id,
          canonical_name: row.canonical_name,
          score: row.score,
          score_version: row.score_version,
          score_breakdown_json: row.score_breakdown_json,
          data_sufficiency: row.data_sufficiency,
          last_observed_at: row.last_observed_at,
          source_observation_ids_json: row.source_observation_ids_json,
          metadata_json: row.metadata_json,
          updated_at: row.updated_at,
        });
        updated += 1;
      } else {
        this.db.prepare(`INSERT INTO leads VALUES (@lead_id,@lead_type,@canonical_name,@normalized_key,@score,@score_version,@score_breakdown_json,@data_sufficiency,@stage,@last_observed_at,@source_observation_ids_json,@metadata_json,@created_at,@updated_at)`).run(row);
        created += 1;
      }
    }
    this.audit({ actorRole: context.actorRole, action: "LEADS_REBUILT", entityType: "LEAD_BATCH", entityId: newId("batch"), after: { created, updated }, requestId: context.requestId });
    return { created, updated, total: groups.size };
  }

  listLeads({ leadType = "", stage = "" } = {}) {
    const where = [];
    const params = {};
    if (leadType) { where.push("lead_type = @leadType"); params.leadType = leadType; }
    if (stage) { where.push("stage = @stage"); params.stage = stage; }
    const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.db.prepare(`SELECT * FROM leads ${sqlWhere} ORDER BY score DESC, last_observed_at DESC`).all(params).map(mapLead);
  }

  getLead(id) {
    return mapLead(this.db.prepare("SELECT * FROM leads WHERE lead_id = ?").get(id));
  }

  reviewLead(id, { action, reason, actorRole, requestId }) {
    const lead = this.getLead(id);
    if (!lead) throw Object.assign(new Error("找不到線索"), { status: 404, code: "LEAD_NOT_FOUND" });
    if (!reason?.trim()) throw Object.assign(new Error("審核原因必填"), { status: 400, code: "REVIEW_REASON_REQUIRED" });
    const states = { SUBMIT: "SUBMITTED", APPROVE: "APPROVED", REJECT: "REJECTED", NEEDS_MORE_DATA: "NEEDS_MORE_DATA", IGNORE: "IGNORED" };
    const afterStatus = states[action];
    if (!afterStatus) throw Object.assign(new Error("不支援的審核動作"), { status: 400, code: "INVALID_REVIEW_ACTION" });
    const timestamp = nowIso();
    const decision = {
      decision_id: newId("decision"), lead_id: id, actor_role: actorRole, action,
      reason: reason.trim(), before_status: lead.stage, after_status: afterStatus, decided_at: timestamp,
    };
    this.transaction(() => {
      this.db.prepare("UPDATE leads SET stage = ?, updated_at = ? WHERE lead_id = ?").run(afterStatus, timestamp, id);
      this.db.prepare("INSERT INTO review_decisions VALUES (@decision_id,@lead_id,@actor_role,@action,@reason,@before_status,@after_status,@decided_at)").run(decision);
      this.audit({ actorRole, action: `LEAD_${action}`, entityType: "LEAD", entityId: id, before: { stage: lead.stage }, after: { stage: afterStatus }, requestId });
    });
    return { decision, lead: this.getLead(id) };
  }

  listReviews() {
    return this.db.prepare(`SELECT r.*, l.canonical_name, l.lead_type, l.score FROM review_decisions r JOIN leads l ON l.lead_id = r.lead_id ORDER BY r.decided_at DESC`).all();
  }

  createPromotionDraft(leadId, context = {}) {
    const lead = this.getLead(leadId);
    if (!lead) throw Object.assign(new Error("找不到線索"), { status: 404, code: "LEAD_NOT_FOUND" });
    if (lead.stage !== "APPROVED") throw Object.assign(new Error("只有已核准線索可建立 Promotion Draft"), { status: 409, code: "LEAD_NOT_APPROVED" });
    const observations = lead.source_observation_ids.map(id => this.getObservation(id)).filter(Boolean);
    const matches = observations.flatMap(item => item.match_candidates || []);
    const draft = buildPromotionDraft(lead, observations, matches);
    const existing = this.db.prepare("SELECT * FROM promotion_drafts WHERE idempotency_key = ?").get(draft.idempotency_key);
    if (existing) return { created: false, draft: mapPromotion(existing) };
    const timestamp = nowIso();
    const row = {
      promotion_draft_id: draft.promotion_draft_id, lead_id: leadId, target_type: draft.target_type,
      contract_version: draft.contract_version, idempotency_key: draft.idempotency_key,
      proposed_fields_json: toJson(draft.proposed_fields), evidence_json: toJson(draft.evidence),
      match_candidates_json: toJson(draft.match_candidates), requested_mode: draft.requested_mode,
      status: draft.status, dry_run_result_json: null, created_at: timestamp, updated_at: timestamp,
    };
    this.db.prepare(`INSERT INTO promotion_drafts VALUES (@promotion_draft_id,@lead_id,@target_type,@contract_version,@idempotency_key,@proposed_fields_json,@evidence_json,@match_candidates_json,@requested_mode,@status,@dry_run_result_json,@created_at,@updated_at)`).run(row);
    this.audit({ actorRole: context.actorRole, action: "PROMOTION_DRAFT_CREATED", entityType: "PROMOTION_DRAFT", entityId: row.promotion_draft_id, after: draft, requestId: context.requestId });
    return { created: true, draft: mapPromotion(row) };
  }

  executePromotionDryRun(id, erpSnapshot, context = {}) {
    const row = this.db.prepare("SELECT * FROM promotion_drafts WHERE promotion_draft_id = ?").get(id);
    if (!row) throw Object.assign(new Error("找不到 Promotion Draft"), { status: 404, code: "PROMOTION_NOT_FOUND" });
    const draft = mapPromotion(row);
    const result = executeDryRun(draft, erpSnapshot);
    const timestamp = nowIso();
    this.db.prepare("UPDATE promotion_drafts SET status='DRY_RUN_COMPLETED',dry_run_result_json=?,updated_at=? WHERE promotion_draft_id=?").run(toJson(result), timestamp, id);
    this.audit({ actorRole: context.actorRole, action: "PROMOTION_DRY_RUN_COMPLETED", entityType: "PROMOTION_DRAFT", entityId: id, before: { status: draft.status }, after: result, requestId: context.requestId });
    return { ...draft, status: "DRY_RUN_COMPLETED", dry_run_result: result, updated_at: timestamp };
  }

  listPromotions() {
    return this.db.prepare("SELECT * FROM promotion_drafts ORDER BY updated_at DESC").all().map(mapPromotion);
  }

  listRuns() {
    return this.db.prepare("SELECT * FROM collection_runs ORDER BY started_at DESC").all().map(row => ({ ...row, errors: fromJson(row.errors_json, []) }));
  }

  listAudit({ limit = 100 } = {}) {
    return this.db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(500, Number(limit) || 100))).map(row => ({ ...row, before: fromJson(row.before_json), after: fromJson(row.after_json) }));
  }

  dashboard() {
    const scalar = sql => this.db.prepare(sql).get().count;
    const sources = scalar("SELECT COUNT(*) AS count FROM sources WHERE active = 1");
    const healthy = scalar("SELECT COUNT(*) AS count FROM sources WHERE active = 1 AND health_status = 'HEALTHY'");
    return {
      observations: scalar("SELECT COUNT(*) AS count FROM observations"),
      vendor_leads: scalar("SELECT COUNT(*) AS count FROM leads WHERE lead_type = 'VENDOR'"),
      kol_leads: scalar("SELECT COUNT(*) AS count FROM leads WHERE lead_type = 'KOL'"),
      pending_review: scalar("SELECT COUNT(*) AS count FROM leads WHERE stage IN ('DISCOVERED','SUBMITTED','NEEDS_MORE_DATA')"),
      promotion_drafts: scalar("SELECT COUNT(*) AS count FROM promotion_drafts"),
      sources,
      source_health_percent: sources ? Math.round(healthy / sources * 100) : null,
    };
  }

  seedDemo(context = { actorRole: "SYSTEM" }) {
    if (this.db.prepare("SELECT COUNT(*) AS count FROM observations").get().count) return { seeded: false };
    const samples = [
      { entity_type: "PRODUCT", title: "輕量氣炸鍋 4.5L", product_name: "輕量氣炸鍋 4.5L", vendor_name: "森活家電（示範）", host_name: "好物研究室", category: "生活家電", platform: "公開團購頁", platform_handle: "good-life-lab", public_email: "partner@example.com", source_url: "https://example.com/groups/air-fryer", price_amount: 2990 },
      { entity_type: "VENDOR", title: "晨光食品（示範）", vendor_name: "晨光食品（示範）", host_name: "吃貨小週末", category: "食品飲料", source_url: "https://example.org/brands/morning-food", public_email: "sales@example.org" },
      { entity_type: "KOL", title: "親子慢生活", host_name: "親子慢生活", vendor_name: "沐光日用（示範）", category: "親子用品", platform: "公開合作頁", platform_handle: "slow-family", source_url: "https://example.net/creators/slow-family" },
    ];
    const results = samples.map(sample => this.createObservation(sample, context));
    const leads = this.rebuildLeads(context);
    return { seeded: true, observations: results.length, leads };
  }
}
