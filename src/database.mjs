import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { COLLECTOR_SOURCE_TYPES, assertSourceCanCollect, normalizeSourceGovernance } from "./collector.mjs";
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
import {
  MARKET_GRAPH_VERSION,
  assertProspectTransition,
  deterministicGraphId,
  kolIdentity,
  normalizeProspectPriority,
  normalizeProspectStage,
  productIdForObservation,
  vendorIdentity,
} from "./market-graph.mjs";

function fromJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function toBoolean(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
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

function mapProduct(row) {
  if (!row) return null;
  return { ...row, normalized_specs: fromJson(row.normalized_specs_json, {}) };
}

function mapVendor(row) {
  if (!row) return null;
  return { ...row, social_urls: fromJson(row.social_urls_json, []) };
}

function mapKol(row) {
  return row ? { ...row } : null;
}

function mapProspect(row) {
  if (!row) return null;
  return { ...row, metadata: fromJson(row.metadata_json, {}) };
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
      CREATE TABLE IF NOT EXISTS collection_run_metadata (
        run_id TEXT PRIMARY KEY REFERENCES collection_runs(run_id),
        target_url TEXT,
        query_text TEXT,
        parser_version TEXT NOT NULL,
        content_hash TEXT,
        fetched_at TEXT
      );
      CREATE TABLE IF NOT EXISTS source_governance (
        source_id TEXT PRIMARY KEY REFERENCES sources(source_id),
        access_mode TEXT NOT NULL DEFAULT 'PUBLIC_NO_LOGIN',
        login_required INTEGER NOT NULL DEFAULT 0,
        terms_status TEXT NOT NULL DEFAULT 'PENDING',
        robots_status TEXT NOT NULL DEFAULT 'UNKNOWN',
        review_notes TEXT,
        owner_name TEXT,
        collection_interval_minutes INTEGER NOT NULL DEFAULT 1440,
        robots_checked_at TEXT
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
      CREATE TABLE IF NOT EXISTS product_candidates (
        product_id TEXT PRIMARY KEY,
        canonical_name TEXT NOT NULL,
        normalized_key TEXT NOT NULL,
        brand TEXT,
        category TEXT,
        normalized_specs_json TEXT NOT NULL DEFAULT '{}',
        identity_basis TEXT NOT NULL,
        identity_value TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        merged_into_product_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_products_name ON product_candidates(normalized_key);
      CREATE INDEX IF NOT EXISTS idx_products_status ON product_candidates(status);
      CREATE TABLE IF NOT EXISTS product_aliases (
        alias_id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES product_candidates(product_id),
        observation_id TEXT NOT NULL UNIQUE REFERENCES observations(observation_id),
        alias_name TEXT NOT NULL,
        normalized_key TEXT NOT NULL,
        match_basis TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_product_aliases_product ON product_aliases(product_id);
      CREATE TABLE IF NOT EXISTS product_match_candidates (
        product_match_id TEXT PRIMARY KEY,
        product_a_id TEXT NOT NULL REFERENCES product_candidates(product_id),
        product_b_id TEXT NOT NULL REFERENCES product_candidates(product_id),
        confidence REAL NOT NULL,
        reasons_json TEXT NOT NULL,
        status TEXT NOT NULL,
        reviewed_by TEXT,
        reviewed_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(product_a_id, product_b_id)
      );
      CREATE TABLE IF NOT EXISTS vendor_candidates (
        vendor_id TEXT PRIMARY KEY,
        display_name TEXT,
        normalized_key TEXT,
        identity_basis TEXT NOT NULL,
        identity_value TEXT NOT NULL,
        website_url TEXT,
        collaboration_url TEXT,
        public_business_email TEXT,
        category TEXT,
        region TEXT,
        social_urls_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        match_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vendor_status ON vendor_candidates(status);
      CREATE TABLE IF NOT EXISTS vendor_evidence (
        vendor_evidence_id TEXT PRIMARY KEY,
        vendor_id TEXT NOT NULL REFERENCES vendor_candidates(vendor_id),
        observation_id TEXT REFERENCES observations(observation_id),
        field TEXT NOT NULL,
        value TEXT NOT NULL,
        source_url TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        confidence REAL NOT NULL,
        parser_version TEXT NOT NULL,
        UNIQUE(vendor_id, field, value, source_url)
      );
      CREATE TABLE IF NOT EXISTS product_vendor_links (
        product_id TEXT NOT NULL REFERENCES product_candidates(product_id),
        vendor_id TEXT NOT NULL REFERENCES vendor_candidates(vendor_id),
        evidence_url TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(product_id, vendor_id)
      );
      CREATE TABLE IF NOT EXISTS kol_candidates (
        kol_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        platform TEXT,
        handle TEXT,
        identity_basis TEXT NOT NULL,
        identity_value TEXT NOT NULL,
        public_collaboration_url TEXT,
        public_business_email TEXT,
        status TEXT NOT NULL,
        match_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kol_handle ON kol_candidates(platform, handle);
      CREATE TABLE IF NOT EXISTS group_buy_events (
        event_id TEXT PRIMARY KEY,
        observation_id TEXT NOT NULL UNIQUE REFERENCES observations(observation_id),
        product_id TEXT NOT NULL REFERENCES product_candidates(product_id),
        vendor_id TEXT REFERENCES vendor_candidates(vendor_id),
        kol_id TEXT REFERENCES kol_candidates(kol_id),
        source_url TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        starts_at TEXT,
        ends_at TEXT,
        event_status TEXT NOT NULL,
        price_amount REAL,
        currency TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_product ON group_buy_events(product_id);
      CREATE INDEX IF NOT EXISTS idx_events_status ON group_buy_events(event_status);
      CREATE TABLE IF NOT EXISTS kol_product_relations (
        relation_id TEXT PRIMARY KEY,
        kol_id TEXT NOT NULL REFERENCES kol_candidates(kol_id),
        product_id TEXT NOT NULL REFERENCES product_candidates(product_id),
        event_id TEXT NOT NULL UNIQUE REFERENCES group_buy_events(event_id),
        platform TEXT,
        handle TEXT,
        source_url TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        relation_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_relations_product ON kol_product_relations(product_id);
      CREATE INDEX IF NOT EXISTS idx_relations_kol ON kol_product_relations(kol_id);
      CREATE TABLE IF NOT EXISTS development_prospects (
        prospect_id TEXT PRIMARY KEY,
        vendor_id TEXT NOT NULL UNIQUE REFERENCES vendor_candidates(vendor_id),
        owner_id TEXT,
        priority TEXT NOT NULL,
        stage TEXT NOT NULL,
        next_action_at TEXT,
        created_by TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_prospects_owner_stage ON development_prospects(owner_id, stage);
      CREATE TABLE IF NOT EXISTS development_assignments (
        assignment_id TEXT PRIMARY KEY,
        prospect_id TEXT NOT NULL REFERENCES development_prospects(prospect_id),
        owner_id TEXT NOT NULL,
        assigned_by TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS development_activities (
        activity_id TEXT PRIMARY KEY,
        prospect_id TEXT NOT NULL REFERENCES development_prospects(prospect_id),
        actor_role TEXT NOT NULL,
        actor_id TEXT,
        action_type TEXT NOT NULL,
        note TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activities_prospect ON development_activities(prospect_id, created_at DESC);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES ('001_initial_mvp', datetime('now'));
      INSERT OR IGNORE INTO source_governance(source_id)
        SELECT source_id FROM sources;
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES ('002_collector_governance', datetime('now'));
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES ('003_m3_m6_market_graph', datetime('now'));
      UPDATE sources SET type='SYNTHETIC_DEMO'
        WHERE type='MANUAL_URL' AND base_url IN ('https://example.com/','https://example.org/','https://example.net/');
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
    const governance = normalizeSourceGovernance(input);
    const row = {
      source_id: input.source_id || newId("src"),
      name: input.name || new URL(baseUrl).hostname,
      type: String(input.type || "MANUAL_URL").toUpperCase(),
      base_url: baseUrl,
      policy_status: String(input.policy_status || "PENDING").toUpperCase(),
      health_status: String(input.health_status || "UNKNOWN").toUpperCase(),
      scrape_allowed: toBoolean(input.scrape_allowed) ? 1 : 0,
      active: input.active === false ? 0 : 1,
      parser_version: input.parser_version || PARSER_VERSION,
      created_at: timestamp,
      updated_at: timestamp,
    };
    const candidate = this.mapSource({ ...row, ...governance, login_required: governance.login_required ? 1 : 0 });
    if (candidate.scrape_allowed) assertSourceCanCollect(candidate);
    const existing = this.db.prepare("SELECT * FROM sources WHERE base_url = ?").get(baseUrl);
    if (existing) return { created: false, source: this.getSource(existing.source_id) };
    this.transaction(() => {
      this.db.prepare(`INSERT INTO sources(source_id,name,type,base_url,policy_status,health_status,scrape_allowed,active,parser_version,created_at,updated_at)
        VALUES (@source_id,@name,@type,@base_url,@policy_status,@health_status,@scrape_allowed,@active,@parser_version,@created_at,@updated_at)`).run(row);
      this.db.prepare(`INSERT INTO source_governance(source_id,access_mode,login_required,terms_status,robots_status,review_notes,owner_name,collection_interval_minutes,robots_checked_at)
        VALUES (@source_id,@access_mode,@login_required,@terms_status,@robots_status,@review_notes,@owner_name,@collection_interval_minutes,NULL)`).run({
        source_id: row.source_id,
        ...governance,
        login_required: governance.login_required ? 1 : 0,
      });
      this.audit({ actorRole: context.actorRole, action: "SOURCE_CREATED", entityType: "SOURCE", entityId: row.source_id, after: candidate, requestId: context.requestId });
    });
    const source = this.getSource(row.source_id);
    return { created: true, source };
  }

  mapSource(row) {
    return { ...row, scrape_allowed: Boolean(row.scrape_allowed), active: Boolean(row.active), login_required: Boolean(row.login_required) };
  }

  listSources() {
    return this.db.prepare(`SELECT s.*, g.access_mode, g.login_required, g.terms_status, g.robots_status, g.review_notes, g.owner_name, g.collection_interval_minutes, g.robots_checked_at
      FROM sources s LEFT JOIN source_governance g ON g.source_id = s.source_id
      ORDER BY s.active DESC, s.updated_at DESC`).all().map(row => this.mapSource(row));
  }

  getSource(id) {
    const row = this.db.prepare(`SELECT s.*, g.access_mode, g.login_required, g.terms_status, g.robots_status, g.review_notes, g.owner_name, g.collection_interval_minutes, g.robots_checked_at
      FROM sources s LEFT JOIN source_governance g ON g.source_id = s.source_id WHERE s.source_id = ?`).get(id);
    return row ? this.mapSource(row) : null;
  }

  liveCollectorCount() {
    return this.db.prepare(`SELECT COUNT(*) AS count FROM sources s JOIN source_governance g ON g.source_id = s.source_id
      WHERE s.active=1 AND s.scrape_allowed=1 AND s.policy_status='APPROVED'
        AND g.access_mode='PUBLIC_NO_LOGIN' AND g.login_required=0 AND g.terms_status='REVIEWED_PUBLIC'`).get().count;
  }

  seedApprovedSources(sources, context = { actorRole: "SYSTEM" }) {
    const results = [];
    for (const source of sources) results.push(this.createSource(source, context));
    return { created: results.filter(item => item.created).length, total: results.length, sources: results.map(item => item.source) };
  }

  markCollectionSuccess(sourceId, { robotsStatus, robotsCheckedAt } = {}, context = {}) {
    const timestamp = nowIso();
    this.transaction(() => {
      this.db.prepare("UPDATE sources SET health_status='HEALTHY',last_success_at=?,updated_at=? WHERE source_id=?").run(timestamp, timestamp, sourceId);
      this.db.prepare("UPDATE source_governance SET robots_status=?,robots_checked_at=? WHERE source_id=?").run(robotsStatus || "UNKNOWN", robotsCheckedAt || timestamp, sourceId);
      this.audit({ actorRole: context.actorRole, action: "SOURCE_COLLECTION_SUCCEEDED", entityType: "SOURCE", entityId: sourceId, after: { health_status: "HEALTHY", robots_status: robotsStatus || "UNKNOWN" }, requestId: context.requestId });
    });
    return this.getSource(sourceId);
  }

  markCollectionFailure(sourceId, error, context = {}) {
    const timestamp = nowIso();
    this.db.prepare("UPDATE sources SET health_status='ERROR',last_error_at=?,updated_at=? WHERE source_id=?").run(timestamp, timestamp, sourceId);
    this.audit({ actorRole: context.actorRole, action: "SOURCE_COLLECTION_FAILED", entityType: "SOURCE", entityId: sourceId, after: { code: error.code || "COLLECTION_FAILED" }, requestId: context.requestId });
    return this.getSource(sourceId);
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

  importObservations(records, { sourceId, idempotencyKey, actorRole, requestId, allowEmpty = false, runMetadata = null, externalErrors = [] } = {}) {
    if (!Array.isArray(records) || (!records.length && !allowEmpty)) throw Object.assign(new Error("匯入內容沒有資料列"), { status: 400, code: "EMPTY_IMPORT" });
    const source = sourceId ? this.db.prepare("SELECT * FROM sources WHERE source_id = ?").get(sourceId) : null;
    if (sourceId && !source) throw Object.assign(new Error("找不到匯入來源"), { status: 404, code: "SOURCE_NOT_FOUND" });
    if (!records.length && !sourceId) throw Object.assign(new Error("空採集結果必須指定來源"), { status: 400, code: "SOURCE_REQUIRED" });
    const runKey = idempotencyKey || sha256({ sourceId: sourceId || "MANUAL", records });
    const existingRun = this.db.prepare("SELECT * FROM collection_runs WHERE idempotency_key = ?").get(runKey);
    if (existingRun) return { replayed: true, run: { ...existingRun, errors: fromJson(existingRun.errors_json, []) } };
    const run = {
      run_id: newId("run"), source_id: sourceId || this.ensureManualSource(records[0].source_url || records[0].sourceUrl, { actorRole, requestId }).source_id,
      status: "RUNNING", idempotency_key: runKey, started_at: nowIso(), completed_at: null,
      created_count: 0, duplicate_count: 0, error_count: 0, errors_json: "[]",
    };
    this.db.prepare(`INSERT INTO collection_runs VALUES (@run_id,@source_id,@status,@idempotency_key,@started_at,@completed_at,@created_count,@duplicate_count,@error_count,@errors_json)`).run(run);
    const errors = [...externalErrors];
    run.error_count = errors.length;
    for (let index = 0; index < records.length; index += 1) {
      try {
        const result = this.createObservation({ ...records[index], source_id: sourceId || undefined }, { actorRole, requestId });
        if (result.created) run.created_count += 1; else run.duplicate_count += 1;
      } catch (error) {
        run.error_count += 1;
        errors.push({ row: index + 1, code: error.code || "IMPORT_ROW_ERROR", message: error.message });
      }
    }
    run.status = run.error_count && !run.created_count && !run.duplicate_count ? "FAILED" : run.error_count ? "PARTIAL" : "COMPLETED";
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
    if (runMetadata) {
      this.db.prepare(`INSERT OR REPLACE INTO collection_run_metadata(run_id,target_url,query_text,parser_version,content_hash,fetched_at)
        VALUES (@run_id,@target_url,@query_text,@parser_version,@content_hash,@fetched_at)`).run({
        run_id: run.run_id,
        target_url: runMetadata.target_url || null,
        query_text: runMetadata.query_text || null,
        parser_version: runMetadata.parser_version || PARSER_VERSION,
        content_hash: runMetadata.content_hash || null,
        fetched_at: runMetadata.fetched_at || run.completed_at,
      });
    }
    this.audit({ actorRole, action: "IMPORT_COMPLETED", entityType: "COLLECTION_RUN", entityId: run.run_id, after: { ...run, errors }, requestId });
    return { replayed: false, run: { ...run, errors } };
  }

  recordCollectionFailure(sourceId, { idempotencyKey, error, runMetadata = null } = {}, context = {}) {
    return this.importObservations([], {
      sourceId,
      idempotencyKey,
      actorRole: context.actorRole,
      requestId: context.requestId,
      allowEmpty: true,
      runMetadata,
      externalErrors: [{ row: null, code: error.code || "COLLECTION_FAILED", message: error.message }],
    });
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

  discoveryFeed({ view = "latest", limit = 200, now = new Date() } = {}) {
    const publicSourceIds = new Set(this.listSources()
      .filter(source => COLLECTOR_SOURCE_TYPES.has(source.type))
      .map(source => source.source_id));
    const items = this.listObservations({ pageSize: Math.max(1, Math.min(200, Number(limit) || 200)) }).items
      .filter(item => publicSourceIds.has(item.source_id) && ["CAMPAIGN", "PRODUCT"].includes(item.entity_type));
    const nowMs = now.getTime();
    const sevenDays = nowMs + 7 * 86_400_000;
    const isEndingSoon = item => {
      const end = item.ends_at ? new Date(item.ends_at).getTime() : NaN;
      return Number.isFinite(end) && end >= nowMs && end <= sevenDays && item.status !== "ENDED";
    };
    const needsReview = item => item.status === "REVIEW_REQUIRED" || !item.product_name || !item.source_url || !item.host_name || (!item.starts_at && !item.ends_at);
    const groups = {
      latest: items,
      active: items.filter(item => item.status === "ACTIVE_OR_RECENT"),
      upcoming: items.filter(item => item.status === "UPCOMING"),
      ending_soon: items.filter(isEndingSoon),
      needs_review: items.filter(needsReview),
    };
    const sourceErrors = this.db.prepare("SELECT COUNT(*) AS count FROM sources WHERE active=1 AND health_status='ERROR'").get().count;
    return {
      view: groups[view] ? view : "latest",
      summary: {
        total: items.length,
        active: groups.active.length,
        upcoming: groups.upcoming.length,
        ending_soon: groups.ending_soon.length,
        needs_review: groups.needs_review.length,
        source_errors: sourceErrors,
      },
      items: groups[view] || groups.latest,
    };
  }

  discoveryMetrics() {
    const liveSources = this.liveCollectorCount();
    const successfulSources = this.db.prepare(`SELECT COUNT(DISTINCT r.source_id) AS count FROM collection_runs r
      JOIN sources s ON s.source_id=r.source_id
      WHERE r.status IN ('COMPLETED','PARTIAL') AND s.type='PUBLIC_LISTING'`).get().count;
    const realEvents = this.db.prepare(`SELECT COUNT(*) AS count FROM observations o
      JOIN sources s ON s.source_id=o.source_id
      WHERE o.entity_type='CAMPAIGN' AND s.type='PUBLIC_LISTING'`).get().count;
    return {
      live_sources: liveSources,
      successful_sources: successfulSources,
      real_market_events: realEvents,
      gate_b_data_volume_passed: successfulSources >= 2 && realEvents >= 30,
    };
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

  rebuildMarketGraph(context = {}) {
    const observations = this.listObservations({ pageSize: 10_000 }).items
      .filter(item => this.getSource(item.source_id)?.type !== "SYNTHETIC_DEMO")
      .filter(item => item.product_name || item.entity_type === "PRODUCT" || item.entity_type === "CAMPAIGN");
    const timestamp = nowIso();
    const stats = { products: 0, events: 0, vendors: 0, kols: 0, relations: 0, product_match_candidates: 0 };
    this.transaction(() => {
      for (const observation of observations) {
        const productName = observation.product_name || observation.title;
        const productIdentity = productIdForObservation(observation);
        const existingProduct = this.db.prepare("SELECT * FROM product_candidates WHERE product_id = ?").get(productIdentity.product_id);
        if (!existingProduct) {
          this.db.prepare(`INSERT INTO product_candidates(product_id,canonical_name,normalized_key,brand,category,normalized_specs_json,identity_basis,identity_value,status,merged_into_product_id,created_at,updated_at)
            VALUES (?,?,?,?,?,'{}',?,?,'ACTIVE',NULL,?,?)`).run(
            productIdentity.product_id, productName, normalizeKey(productName), observation.brand || null, observation.category || null,
            productIdentity.basis, productIdentity.value, timestamp, timestamp,
          );
          stats.products += 1;
        } else {
          this.db.prepare(`UPDATE product_candidates SET canonical_name=COALESCE(NULLIF(canonical_name,''),?),brand=COALESCE(brand,?),category=COALESCE(category,?),updated_at=? WHERE product_id=?`)
            .run(productName, observation.brand || null, observation.category || null, timestamp, productIdentity.product_id);
        }

        const aliasId = deterministicGraphId("alias", observation.observation_id);
        this.db.prepare(`INSERT OR IGNORE INTO product_aliases(alias_id,product_id,observation_id,alias_name,normalized_key,match_basis,confidence,status,created_at)
          VALUES (?,?,?,?,?,?,?,'ACTIVE',?)`).run(aliasId, productIdentity.product_id, observation.observation_id, productName, normalizeKey(productName), productIdentity.basis, productIdentity.confidence, timestamp);

        if (!productIdentity.auto_merge) {
          const sameNameProducts = this.db.prepare(`SELECT product_id FROM product_candidates WHERE normalized_key=? AND product_id<>? AND status='ACTIVE'`).all(normalizeKey(productName), productIdentity.product_id);
          for (const other of sameNameProducts) {
            const [productA, productB] = [productIdentity.product_id, other.product_id].sort();
            const matchId = deterministicGraphId("pmatch", `${productA}:${productB}`);
            const result = this.db.prepare(`INSERT OR IGNORE INTO product_match_candidates(product_match_id,product_a_id,product_b_id,confidence,reasons_json,status,created_at)
              VALUES (?,?,?,0.55,?,'PENDING',?)`).run(matchId, productA, productB, toJson(["EXACT_NORMALIZED_NAME", "NAME_ONLY_REQUIRES_HUMAN_REVIEW"]), timestamp);
            if (result.changes) stats.product_match_candidates += 1;
          }
        }

        const vendorIdentityResult = vendorIdentity(observation, productIdentity.product_id);
        const vendorId = deterministicGraphId("vendor", `${vendorIdentityResult.basis}:${vendorIdentityResult.value}`);
        const vendorExists = this.db.prepare("SELECT vendor_id FROM vendor_candidates WHERE vendor_id=?").get(vendorId);
        if (!vendorExists) {
          this.db.prepare(`INSERT INTO vendor_candidates(vendor_id,display_name,normalized_key,identity_basis,identity_value,website_url,collaboration_url,public_business_email,category,region,social_urls_json,status,match_status,created_at,updated_at)
            VALUES (?,?,?,?,?,NULL,NULL,?,?,NULL,'[]',?,?,?,?)`).run(
            vendorId, observation.vendor_name || null, normalizeKey(observation.vendor_name), vendorIdentityResult.basis, vendorIdentityResult.value,
            observation.public_email || null, observation.category || null,
            observation.vendor_name ? (observation.public_email ? "PARTIAL" : "NEEDS_MORE_DATA") : "NEEDS_ENRICHMENT",
            vendorIdentityResult.confidence >= 0.95 ? "STABLE" : "REVIEW_REQUIRED", timestamp, timestamp,
          );
          stats.vendors += 1;
        } else if (observation.vendor_name || observation.public_email || observation.category) {
          this.db.prepare(`UPDATE vendor_candidates SET display_name=COALESCE(display_name,?),normalized_key=COALESCE(normalized_key,?),public_business_email=COALESCE(public_business_email,?),category=COALESCE(category,?),updated_at=? WHERE vendor_id=?`)
            .run(observation.vendor_name || null, normalizeKey(observation.vendor_name), observation.public_email || null, observation.category || null, timestamp, vendorId);
        }
        const vendorEvidence = [
          ["display_name", observation.vendor_name],
          ["public_business_email", observation.public_email],
          ["category", observation.category],
        ];
        for (const [field, value] of vendorEvidence) {
          if (!value) continue;
          const evidenceId = deterministicGraphId("vevd", `${vendorId}:${field}:${value}:${observation.source_url}`);
          this.db.prepare(`INSERT OR IGNORE INTO vendor_evidence(vendor_evidence_id,vendor_id,observation_id,field,value,source_url,captured_at,confidence,parser_version)
            VALUES (?,?,?,?,?,?,?,?,?)`).run(evidenceId, vendorId, observation.observation_id, field, String(value), observation.source_url, observation.observed_at, observation.confidence ?? vendorIdentityResult.confidence, observation.parser_version);
        }
        this.db.prepare(`INSERT OR IGNORE INTO product_vendor_links(product_id,vendor_id,evidence_url,confidence,status,created_at) VALUES (?,?,?,?,?,?)`)
          .run(productIdentity.product_id, vendorId, observation.source_url, vendorIdentityResult.confidence, observation.vendor_name ? "OBSERVED" : "NEEDS_ENRICHMENT", timestamp);

        let kolId = null;
        if (observation.host_name) {
          const identity = kolIdentity(observation);
          kolId = deterministicGraphId("kol", `${identity.basis}:${identity.value}`);
          const kolExists = this.db.prepare("SELECT kol_id FROM kol_candidates WHERE kol_id=?").get(kolId);
          if (!kolExists) {
            this.db.prepare(`INSERT INTO kol_candidates(kol_id,display_name,platform,handle,identity_basis,identity_value,public_collaboration_url,public_business_email,status,match_status,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,'ACTIVE',?,?,?)`).run(kolId, observation.host_name, observation.platform || null, observation.platform_handle || null, identity.basis, identity.value, observation.source_url, observation.public_email || null, identity.match_status, timestamp, timestamp);
            stats.kols += 1;
          } else {
            this.db.prepare(`UPDATE kol_candidates SET display_name=?,platform=COALESCE(platform,?),handle=COALESCE(handle,?),public_collaboration_url=COALESCE(public_collaboration_url,?),updated_at=? WHERE kol_id=?`)
              .run(observation.host_name, observation.platform || null, observation.platform_handle || null, observation.source_url, timestamp, kolId);
          }
        }

        const eventId = deterministicGraphId("event", observation.observation_id);
        const eventExists = this.db.prepare("SELECT event_id FROM group_buy_events WHERE observation_id=?").get(observation.observation_id);
        if (!eventExists) {
          this.db.prepare(`INSERT INTO group_buy_events(event_id,observation_id,product_id,vendor_id,kol_id,source_url,observed_at,starts_at,ends_at,event_status,price_amount,currency,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(eventId, observation.observation_id, productIdentity.product_id, vendorId, kolId, observation.source_url, observation.observed_at, observation.starts_at, observation.ends_at, observation.status, observation.price_amount, observation.currency, timestamp, timestamp);
          stats.events += 1;
        } else {
          this.db.prepare(`UPDATE group_buy_events SET product_id=?,vendor_id=?,kol_id=?,starts_at=?,ends_at=?,event_status=?,price_amount=?,currency=?,updated_at=? WHERE observation_id=?`)
            .run(productIdentity.product_id, vendorId, kolId, observation.starts_at, observation.ends_at, observation.status, observation.price_amount, observation.currency, timestamp, observation.observation_id);
        }

        if (kolId) {
          const relationId = deterministicGraphId("relation", eventId);
          const relation = this.db.prepare("SELECT relation_id FROM kol_product_relations WHERE event_id=?").get(eventId);
          if (!relation) {
            this.db.prepare(`INSERT INTO kol_product_relations(relation_id,kol_id,product_id,event_id,platform,handle,source_url,first_seen_at,last_seen_at,relation_status,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,? ,?,?)`).run(relationId, kolId, productIdentity.product_id, eventId, observation.platform, observation.platform_handle, observation.source_url, observation.observed_at, observation.observed_at, observation.status, timestamp, timestamp);
            stats.relations += 1;
          } else {
            this.db.prepare(`UPDATE kol_product_relations SET kol_id=?,product_id=?,last_seen_at=?,relation_status=?,updated_at=? WHERE event_id=?`)
              .run(kolId, productIdentity.product_id, observation.observed_at, observation.status, timestamp, eventId);
          }
        }
      }
      const duplicateProductNames = this.db.prepare(`SELECT a.product_id AS product_a_id,b.product_id AS product_b_id
        FROM product_candidates a JOIN product_candidates b ON a.normalized_key=b.normalized_key AND a.product_id<b.product_id
        WHERE a.status='ACTIVE' AND b.status='ACTIVE' AND (a.identity_basis='OBSERVATION_SCOPED' OR b.identity_basis='OBSERVATION_SCOPED')`).all();
      for (const pair of duplicateProductNames) {
        const matchId = deterministicGraphId("pmatch", `${pair.product_a_id}:${pair.product_b_id}`);
        const result = this.db.prepare(`INSERT OR IGNORE INTO product_match_candidates(product_match_id,product_a_id,product_b_id,confidence,reasons_json,status,created_at)
          VALUES (?,?,?,0.55,?,'PENDING',?)`).run(matchId, pair.product_a_id, pair.product_b_id, toJson(["EXACT_NORMALIZED_NAME", "NAME_ONLY_REQUIRES_HUMAN_REVIEW"]), timestamp);
        if (result.changes) stats.product_match_candidates += 1;
      }
      this.db.prepare(`UPDATE product_candidates AS p SET status='ARCHIVED',updated_at=?
        WHERE status='ACTIVE' AND NOT EXISTS (
          SELECT 1 FROM product_aliases a JOIN observations o ON o.observation_id=a.observation_id JOIN sources s ON s.source_id=o.source_id
          WHERE a.product_id=p.product_id AND s.type<>'SYNTHETIC_DEMO'
        )`).run(timestamp);
      this.db.prepare(`UPDATE group_buy_events SET event_status='DEMO_EXCLUDED',updated_at=? WHERE observation_id IN (
        SELECT o.observation_id FROM observations o JOIN sources s ON s.source_id=o.source_id WHERE s.type='SYNTHETIC_DEMO'
      )`).run(timestamp);
      this.audit({ actorRole: context.actorRole, action: "MARKET_GRAPH_REBUILT", entityType: "MARKET_GRAPH", entityId: MARKET_GRAPH_VERSION, after: stats, requestId: context.requestId });
    });
    return { version: MARKET_GRAPH_VERSION, processed_observations: observations.length, ...stats, totals: this.marketGraphMetrics() };
  }

  marketGraphMetrics() {
    const count = table => this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    const activeProducts = this.db.prepare("SELECT COUNT(*) AS count FROM product_candidates WHERE status='ACTIVE'").get().count;
    const activeProspects = this.db.prepare("SELECT COUNT(*) AS count FROM development_prospects WHERE stage NOT IN ('WON','LOST','DO_NOT_CONTACT')").get().count;
    return {
      products: activeProducts,
      all_products: count("product_candidates"),
      active_products: activeProducts,
      events: this.db.prepare("SELECT COUNT(*) AS count FROM group_buy_events e JOIN product_candidates p ON p.product_id=e.product_id WHERE p.status='ACTIVE'").get().count,
      vendors: this.db.prepare("SELECT COUNT(DISTINCT l.vendor_id) AS count FROM product_vendor_links l JOIN product_candidates p ON p.product_id=l.product_id WHERE p.status='ACTIVE'").get().count,
      vendors_enriched: this.db.prepare("SELECT COUNT(*) AS count FROM vendor_candidates WHERE status IN ('PARTIAL','ENRICHED')").get().count,
      kols: this.db.prepare("SELECT COUNT(DISTINCT r.kol_id) AS count FROM kol_product_relations r JOIN product_candidates p ON p.product_id=r.product_id WHERE p.status='ACTIVE'").get().count,
      kol_product_relations: this.db.prepare("SELECT COUNT(*) AS count FROM kol_product_relations r JOIN product_candidates p ON p.product_id=r.product_id WHERE p.status='ACTIVE'").get().count,
      product_matches_pending: this.db.prepare("SELECT COUNT(*) AS count FROM product_match_candidates WHERE status='PENDING'").get().count,
      prospects: count("development_prospects"),
      active_prospects: activeProspects,
      pipeline_ready: activeProducts > 0 && count("group_buy_events") > 0 && count("kol_product_relations") > 0,
    };
  }

  listProducts({ query = "", status = "ACTIVE", limit = 200 } = {}) {
    const where = [];
    const params = { limit: Math.max(1, Math.min(500, Number(limit) || 200)) };
    if (query) { where.push("(p.canonical_name LIKE @query OR p.brand LIKE @query OR p.category LIKE @query)"); params.query = `%${query}%`; }
    if (status) { where.push("p.status=@status"); params.status = status; }
    const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.db.prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM group_buy_events e WHERE e.product_id=p.product_id) AS event_count,
      (SELECT COUNT(DISTINCT r.kol_id) FROM kol_product_relations r WHERE r.product_id=p.product_id) AS kol_count,
      (SELECT MIN(e.price_amount) FROM group_buy_events e WHERE e.product_id=p.product_id AND e.price_amount IS NOT NULL) AS min_price,
      (SELECT MAX(e.price_amount) FROM group_buy_events e WHERE e.product_id=p.product_id AND e.price_amount IS NOT NULL) AS max_price,
      (SELECT COUNT(*) FROM product_match_candidates m WHERE (m.product_a_id=p.product_id OR m.product_b_id=p.product_id) AND m.status='PENDING') AS pending_match_count,
      (SELECT GROUP_CONCAT(DISTINCT COALESCE(v.display_name,'UNKNOWN')) FROM product_vendor_links l JOIN vendor_candidates v ON v.vendor_id=l.vendor_id WHERE l.product_id=p.product_id) AS vendor_names
      FROM product_candidates p ${sqlWhere} ORDER BY p.updated_at DESC LIMIT @limit`).all(params).map(mapProduct);
  }

  getProduct(id) {
    const product = mapProduct(this.db.prepare("SELECT * FROM product_candidates WHERE product_id=?").get(id));
    if (!product) return null;
    product.aliases = this.db.prepare("SELECT * FROM product_aliases WHERE product_id=? ORDER BY created_at").all(id);
    product.events = this.db.prepare(`SELECT e.*,k.display_name AS kol_name,k.platform,k.handle,v.display_name AS vendor_name
      FROM group_buy_events e LEFT JOIN kol_candidates k ON k.kol_id=e.kol_id LEFT JOIN vendor_candidates v ON v.vendor_id=e.vendor_id
      WHERE e.product_id=? ORDER BY e.observed_at DESC`).all(id);
    product.vendors = this.db.prepare(`SELECT v.*,l.evidence_url,l.confidence AS link_confidence,l.status AS link_status
      FROM product_vendor_links l JOIN vendor_candidates v ON v.vendor_id=l.vendor_id WHERE l.product_id=?`).all(id).map(mapVendor);
    product.kols = this.db.prepare(`SELECT k.*,COUNT(*) AS event_count,MIN(r.first_seen_at) AS first_seen_at,MAX(r.last_seen_at) AS last_seen_at
      FROM kol_product_relations r JOIN kol_candidates k ON k.kol_id=r.kol_id WHERE r.product_id=? GROUP BY k.kol_id ORDER BY last_seen_at DESC`).all(id).map(mapKol);
    product.match_candidates = this.db.prepare(`SELECT m.*,a.canonical_name AS product_a_name,b.canonical_name AS product_b_name
      FROM product_match_candidates m JOIN product_candidates a ON a.product_id=m.product_a_id JOIN product_candidates b ON b.product_id=m.product_b_id
      WHERE m.product_a_id=? OR m.product_b_id=? ORDER BY m.created_at DESC`).all(id, id).map(row => ({ ...row, reasons: fromJson(row.reasons_json, []) }));
    return product;
  }

  reviewProductMatch(id, { action, actorRole, requestId } = {}) {
    const decision = String(action || "").toUpperCase();
    if (!["MERGE", "REJECT"].includes(decision)) throw Object.assign(new Error("不支援的商品比對決策"), { status: 400, code: "INVALID_PRODUCT_MATCH_ACTION" });
    const match = this.db.prepare("SELECT * FROM product_match_candidates WHERE product_match_id=?").get(id);
    if (!match) throw Object.assign(new Error("找不到商品比對候選"), { status: 404, code: "PRODUCT_MATCH_NOT_FOUND" });
    if (match.status !== "PENDING") return { replayed: true, match };
    const timestamp = nowIso();
    this.transaction(() => {
      if (decision === "MERGE") {
        this.db.prepare("UPDATE product_aliases SET product_id=? WHERE product_id=?").run(match.product_a_id, match.product_b_id);
        this.db.prepare("UPDATE group_buy_events SET product_id=?,updated_at=? WHERE product_id=?").run(match.product_a_id, timestamp, match.product_b_id);
        this.db.prepare("UPDATE kol_product_relations SET product_id=?,updated_at=? WHERE product_id=?").run(match.product_a_id, timestamp, match.product_b_id);
        this.db.prepare(`INSERT OR IGNORE INTO product_vendor_links(product_id,vendor_id,evidence_url,confidence,status,created_at)
          SELECT ?,vendor_id,evidence_url,confidence,status,created_at FROM product_vendor_links WHERE product_id=?`).run(match.product_a_id, match.product_b_id);
        this.db.prepare("DELETE FROM product_vendor_links WHERE product_id=?").run(match.product_b_id);
        this.db.prepare("UPDATE product_candidates SET status='MERGED',merged_into_product_id=?,updated_at=? WHERE product_id=?").run(match.product_a_id, timestamp, match.product_b_id);
      }
      this.db.prepare("UPDATE product_match_candidates SET status=?,reviewed_by=?,reviewed_at=? WHERE product_match_id=?").run(decision === "MERGE" ? "APPROVED" : "REJECTED", actorRole, timestamp, id);
      this.audit({ actorRole, action: `PRODUCT_MATCH_${decision}`, entityType: "PRODUCT_MATCH", entityId: id, before: match, after: { status: decision }, requestId });
    });
    return { replayed: false, match: this.db.prepare("SELECT * FROM product_match_candidates WHERE product_match_id=?").get(id), product: this.getProduct(match.product_a_id) };
  }

  splitProductAlias(aliasId, context = {}) {
    const alias = this.db.prepare(`SELECT a.*,o.brand,o.category FROM product_aliases a JOIN observations o ON o.observation_id=a.observation_id WHERE a.alias_id=?`).get(aliasId);
    if (!alias) throw Object.assign(new Error("找不到商品別名"), { status: 404, code: "PRODUCT_ALIAS_NOT_FOUND" });
    const timestamp = nowIso();
    const newProductId = deterministicGraphId("product", `MANUAL_SPLIT:${alias.alias_id}`);
    if (alias.product_id === newProductId) return { replayed: true, product: this.getProduct(newProductId) };
    this.transaction(() => {
      this.db.prepare(`INSERT OR IGNORE INTO product_candidates(product_id,canonical_name,normalized_key,brand,category,normalized_specs_json,identity_basis,identity_value,status,merged_into_product_id,created_at,updated_at)
        VALUES (?,?,?,?,?,'{}','MANUAL_SPLIT',?,'ACTIVE',NULL,?,?)`).run(newProductId, alias.alias_name, alias.normalized_key, alias.brand, alias.category, alias.alias_id, timestamp, timestamp);
      this.db.prepare("UPDATE product_aliases SET product_id=?,match_basis='MANUAL_SPLIT',confidence=1 WHERE alias_id=?").run(newProductId, aliasId);
      const event = this.db.prepare("SELECT event_id FROM group_buy_events WHERE observation_id=?").get(alias.observation_id);
      if (event) {
        this.db.prepare("UPDATE group_buy_events SET product_id=?,updated_at=? WHERE event_id=?").run(newProductId, timestamp, event.event_id);
        this.db.prepare("UPDATE kol_product_relations SET product_id=?,updated_at=? WHERE event_id=?").run(newProductId, timestamp, event.event_id);
      }
      this.audit({ actorRole: context.actorRole, action: "PRODUCT_ALIAS_SPLIT", entityType: "PRODUCT_ALIAS", entityId: aliasId, before: { product_id: alias.product_id }, after: { product_id: newProductId }, requestId: context.requestId });
    });
    return { replayed: false, product: this.getProduct(newProductId) };
  }

  listVendors({ query = "", status = "", limit = 200 } = {}) {
    const where = [];
    const params = { limit: Math.max(1, Math.min(500, Number(limit) || 200)) };
    if (query) { where.push("(v.display_name LIKE @query OR v.category LIKE @query OR v.public_business_email LIKE @query)"); params.query = `%${query}%`; }
    if (status) { where.push("v.status=@status"); params.status = status; }
    const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.db.prepare(`SELECT v.*,(SELECT COUNT(DISTINCT l.product_id) FROM product_vendor_links l WHERE l.vendor_id=v.vendor_id) AS product_count,
      (SELECT COUNT(*) FROM vendor_evidence e WHERE e.vendor_id=v.vendor_id) AS evidence_count,
      (SELECT prospect_id FROM development_prospects p WHERE p.vendor_id=v.vendor_id) AS prospect_id
      FROM vendor_candidates v ${sqlWhere} ORDER BY v.updated_at DESC LIMIT @limit`).all(params).map(mapVendor);
  }

  getVendor(id) {
    const vendor = mapVendor(this.db.prepare("SELECT * FROM vendor_candidates WHERE vendor_id=?").get(id));
    if (!vendor) return null;
    vendor.evidence = this.db.prepare("SELECT * FROM vendor_evidence WHERE vendor_id=? ORDER BY captured_at DESC").all(id);
    vendor.products = this.db.prepare(`SELECT p.*,l.evidence_url,l.confidence AS link_confidence,l.status AS link_status FROM product_vendor_links l JOIN product_candidates p ON p.product_id=l.product_id WHERE l.vendor_id=?`).all(id).map(mapProduct);
    vendor.prospect = mapProspect(this.db.prepare("SELECT * FROM development_prospects WHERE vendor_id=?").get(id));
    return vendor;
  }

  enrichVendor(id, input, context = {}) {
    const before = this.getVendor(id);
    if (!before) throw Object.assign(new Error("找不到廠商候選"), { status: 404, code: "VENDOR_CANDIDATE_NOT_FOUND" });
    const allowed = ["display_name", "website_url", "collaboration_url", "public_business_email", "category", "region"];
    const updates = Object.fromEntries(allowed.filter(field => input[field] !== undefined).map(field => [field, input[field] || null]));
    if (!Object.keys(updates).length) throw Object.assign(new Error("沒有可更新的公開廠商欄位"), { status: 400, code: "EMPTY_VENDOR_ENRICHMENT" });
    if (!input.evidence_source_url) throw Object.assign(new Error("廠商補充必須提供公開證據 URL"), { status: 400, code: "VENDOR_EVIDENCE_REQUIRED" });
    const timestamp = nowIso();
    const merged = { ...before, ...updates };
    const status = merged.display_name && (merged.website_url || merged.collaboration_url || merged.public_business_email) ? "ENRICHED" : merged.display_name ? "PARTIAL" : "NEEDS_ENRICHMENT";
    this.transaction(() => {
      this.db.prepare(`UPDATE vendor_candidates SET display_name=?,normalized_key=?,website_url=?,collaboration_url=?,public_business_email=?,category=?,region=?,status=?,updated_at=? WHERE vendor_id=?`)
        .run(merged.display_name, normalizeKey(merged.display_name), merged.website_url, merged.collaboration_url, merged.public_business_email, merged.category, merged.region, status, timestamp, id);
      for (const [field, value] of Object.entries(updates)) {
        if (!value) continue;
        const evidenceId = deterministicGraphId("vevd", `${id}:${field}:${value}:${input.evidence_source_url}`);
        this.db.prepare(`INSERT OR IGNORE INTO vendor_evidence(vendor_evidence_id,vendor_id,observation_id,field,value,source_url,captured_at,confidence,parser_version)
          VALUES (?,?,NULL,?,?,?,?,?,?)`).run(evidenceId, id, field, String(value), input.evidence_source_url, timestamp, Number(input.confidence || 0.9), input.parser_version || "manual-public-enrichment-1.0.0");
      }
      this.audit({ actorRole: context.actorRole, action: "VENDOR_PUBLIC_DATA_ENRICHED", entityType: "VENDOR_CANDIDATE", entityId: id, before, after: { ...updates, status, evidence_source_url: input.evidence_source_url }, requestId: context.requestId });
    });
    return this.getVendor(id);
  }

  listKols({ query = "", limit = 200 } = {}) {
    const params = { limit: Math.max(1, Math.min(500, Number(limit) || 200)) };
    let where = "";
    if (query) { where = "WHERE k.display_name LIKE @query OR k.handle LIKE @query OR k.platform LIKE @query"; params.query = `%${query}%`; }
    return this.db.prepare(`SELECT k.*,COUNT(DISTINCT r.product_id) AS product_count,COUNT(r.event_id) AS event_count,MAX(r.last_seen_at) AS last_seen_at
      FROM kol_candidates k LEFT JOIN kol_product_relations r ON r.kol_id=k.kol_id ${where} GROUP BY k.kol_id ORDER BY last_seen_at DESC LIMIT @limit`).all(params).map(mapKol);
  }

  getKol(id) {
    const kol = mapKol(this.db.prepare("SELECT * FROM kol_candidates WHERE kol_id=?").get(id));
    if (!kol) return null;
    kol.products = this.db.prepare(`SELECT p.*,COUNT(r.event_id) AS event_count,MIN(r.first_seen_at) AS first_seen_at,MAX(r.last_seen_at) AS last_seen_at
      FROM kol_product_relations r JOIN product_candidates p ON p.product_id=r.product_id WHERE r.kol_id=? GROUP BY p.product_id ORDER BY last_seen_at DESC`).all(id).map(mapProduct);
    kol.relations = this.db.prepare("SELECT * FROM kol_product_relations WHERE kol_id=? ORDER BY last_seen_at DESC").all(id);
    return kol;
  }

  addProspect(vendorId, input = {}, context = {}) {
    const vendor = this.getVendor(vendorId);
    if (!vendor) throw Object.assign(new Error("找不到廠商候選"), { status: 404, code: "VENDOR_CANDIDATE_NOT_FOUND" });
    if (!vendor.display_name) throw Object.assign(new Error("請先補充並確認廠商名稱，再加入開發名單"), { status: 409, code: "VENDOR_ENRICHMENT_REQUIRED" });
    const existing = this.db.prepare("SELECT * FROM development_prospects WHERE vendor_id=?").get(vendorId);
    if (existing) return { created: false, prospect: this.getProspect(existing.prospect_id) };
    const timestamp = nowIso();
    const ownerId = input.owner_id || null;
    const stage = normalizeProspectStage(input.stage || (ownerId ? "ASSIGNED" : "PLANNED"));
    const prospectId = deterministicGraphId("prospect", vendorId);
    this.transaction(() => {
      this.db.prepare(`INSERT INTO development_prospects(prospect_id,vendor_id,owner_id,priority,stage,next_action_at,created_by,metadata_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(prospectId, vendorId, ownerId, normalizeProspectPriority(input.priority), stage, input.next_action_at || null, context.actorRole || "SYSTEM", toJson({ source: "VENDOR_CANDIDATE" }), timestamp, timestamp);
      if (ownerId) this.db.prepare("INSERT INTO development_assignments VALUES (?,?,?,?,?,1)").run(newId("assign"), prospectId, ownerId, context.actorRole || "SYSTEM", timestamp);
      this.db.prepare("INSERT INTO development_activities VALUES (?,?,?,?,?,?,?,?)").run(newId("activity"), prospectId, context.actorRole || "SYSTEM", input.actor_id || null, "PROSPECT_CREATED", input.note || null, toJson({ priority: normalizeProspectPriority(input.priority), owner_id: ownerId }), timestamp);
      this.audit({ actorRole: context.actorRole, action: "DEVELOPMENT_PROSPECT_CREATED", entityType: "DEVELOPMENT_PROSPECT", entityId: prospectId, after: { vendor_id: vendorId, owner_id: ownerId, stage }, requestId: context.requestId });
    });
    return { created: true, prospect: this.getProspect(prospectId) };
  }

  listProspects({ ownerId = "", stage = "", query = "" } = {}) {
    const where = [];
    const params = {};
    if (ownerId) { where.push("p.owner_id=@ownerId"); params.ownerId = ownerId; }
    if (stage) { where.push("p.stage=@stage"); params.stage = normalizeProspectStage(stage); }
    if (query) { where.push("(v.display_name LIKE @query OR p.owner_id LIKE @query)"); params.query = `%${query}%`; }
    const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.db.prepare(`SELECT p.*,v.display_name AS vendor_name,v.category,v.website_url,v.public_business_email,
      (SELECT COUNT(*) FROM development_activities a WHERE a.prospect_id=p.prospect_id) AS activity_count
      FROM development_prospects p JOIN vendor_candidates v ON v.vendor_id=p.vendor_id ${sqlWhere}
      ORDER BY CASE p.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,p.next_action_at IS NULL,p.next_action_at,p.updated_at DESC`).all(params).map(mapProspect);
  }

  getProspect(id) {
    const prospect = mapProspect(this.db.prepare(`SELECT p.*,v.display_name AS vendor_name,v.category,v.website_url,v.collaboration_url,v.public_business_email
      FROM development_prospects p JOIN vendor_candidates v ON v.vendor_id=p.vendor_id WHERE p.prospect_id=?`).get(id));
    if (!prospect) return null;
    prospect.assignments = this.db.prepare("SELECT * FROM development_assignments WHERE prospect_id=? ORDER BY assigned_at DESC").all(id).map(row => ({ ...row, active: Boolean(row.active) }));
    prospect.activities = this.db.prepare("SELECT * FROM development_activities WHERE prospect_id=? ORDER BY created_at DESC").all(id).map(row => ({ ...row, metadata: fromJson(row.metadata_json, {}) }));
    return prospect;
  }

  updateProspect(id, input = {}, context = {}) {
    const before = this.getProspect(id);
    if (!before) throw Object.assign(new Error("找不到預計開發項目"), { status: 404, code: "PROSPECT_NOT_FOUND" });
    const stage = input.stage ? assertProspectTransition(before.stage, input.stage) : before.stage;
    const priority = input.priority ? normalizeProspectPriority(input.priority) : before.priority;
    const ownerId = input.owner_id !== undefined ? input.owner_id || null : before.owner_id;
    const nextActionAt = input.next_action_at !== undefined ? input.next_action_at || null : before.next_action_at;
    const timestamp = nowIso();
    this.transaction(() => {
      this.db.prepare("UPDATE development_prospects SET owner_id=?,priority=?,stage=?,next_action_at=?,updated_at=? WHERE prospect_id=?").run(ownerId, priority, stage, nextActionAt, timestamp, id);
      if (ownerId !== before.owner_id) {
        this.db.prepare("UPDATE development_assignments SET active=0 WHERE prospect_id=? AND active=1").run(id);
        if (ownerId) this.db.prepare("INSERT INTO development_assignments VALUES (?,?,?,?,?,1)").run(newId("assign"), id, ownerId, context.actorRole || "SYSTEM", timestamp);
      }
      this.db.prepare("INSERT INTO development_activities VALUES (?,?,?,?,?,?,?,?)").run(newId("activity"), id, context.actorRole || "SYSTEM", input.actor_id || null, "PROSPECT_UPDATED", input.note || null, toJson({ before: { owner_id: before.owner_id, priority: before.priority, stage: before.stage, next_action_at: before.next_action_at }, after: { owner_id: ownerId, priority, stage, next_action_at: nextActionAt } }), timestamp);
      this.audit({ actorRole: context.actorRole, action: "DEVELOPMENT_PROSPECT_UPDATED", entityType: "DEVELOPMENT_PROSPECT", entityId: id, before, after: { owner_id: ownerId, priority, stage, next_action_at: nextActionAt }, requestId: context.requestId });
    });
    return this.getProspect(id);
  }

  addProspectActivity(id, input = {}, context = {}) {
    const prospect = this.getProspect(id);
    if (!prospect) throw Object.assign(new Error("找不到預計開發項目"), { status: 404, code: "PROSPECT_NOT_FOUND" });
    if (!input.note) throw Object.assign(new Error("活動紀錄必須包含備註"), { status: 400, code: "ACTIVITY_NOTE_REQUIRED" });
    const row = { activity_id: newId("activity"), prospect_id: id, actor_role: context.actorRole || "SYSTEM", actor_id: input.actor_id || null, action_type: String(input.action_type || "NOTE").toUpperCase(), note: input.note, metadata_json: toJson(input.metadata || {}), created_at: nowIso() };
    this.transaction(() => {
      this.db.prepare("INSERT INTO development_activities VALUES (@activity_id,@prospect_id,@actor_role,@actor_id,@action_type,@note,@metadata_json,@created_at)").run(row);
      this.db.prepare("UPDATE development_prospects SET updated_at=? WHERE prospect_id=?").run(row.created_at, id);
      this.audit({ actorRole: context.actorRole, action: "DEVELOPMENT_ACTIVITY_ADDED", entityType: "DEVELOPMENT_PROSPECT", entityId: id, after: { action_type: row.action_type, note: row.note }, requestId: context.requestId });
    });
    return { ...row, metadata: fromJson(row.metadata_json, {}) };
  }

  pipelineSummary() {
    const stages = Object.fromEntries(this.db.prepare("SELECT stage,COUNT(*) AS count FROM development_prospects GROUP BY stage").all().map(row => [row.stage, row.count]));
    const owners = this.db.prepare("SELECT COALESCE(owner_id,'UNASSIGNED') AS owner_id,COUNT(*) AS count FROM development_prospects GROUP BY COALESCE(owner_id,'UNASSIGNED') ORDER BY count DESC").all();
    return { total: this.db.prepare("SELECT COUNT(*) AS count FROM development_prospects").get().count, stages, owners };
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
    return this.db.prepare(`SELECT r.*, m.target_url, m.query_text, m.parser_version AS run_parser_version, m.content_hash, m.fetched_at
      FROM collection_runs r LEFT JOIN collection_run_metadata m ON m.run_id = r.run_id ORDER BY r.started_at DESC`).all().map(row => ({ ...row, errors: fromJson(row.errors_json, []) }));
  }

  getRunByIdempotencyKey(key) {
    if (!key) return null;
    const row = this.db.prepare(`SELECT r.*, m.target_url, m.query_text, m.parser_version AS run_parser_version, m.content_hash, m.fetched_at
      FROM collection_runs r LEFT JOIN collection_run_metadata m ON m.run_id = r.run_id WHERE r.idempotency_key = ?`).get(key);
    return row ? { ...row, errors: fromJson(row.errors_json, []) } : null;
  }

  listAudit({ limit = 100 } = {}) {
    return this.db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(500, Number(limit) || 100))).map(row => ({ ...row, before: fromJson(row.before_json), after: fromJson(row.after_json) }));
  }

  dashboard() {
    const scalar = sql => this.db.prepare(sql).get().count;
    const sources = scalar("SELECT COUNT(*) AS count FROM sources WHERE active = 1");
    const healthy = scalar("SELECT COUNT(*) AS count FROM sources WHERE active = 1 AND health_status = 'HEALTHY'");
    const discovery = this.discoveryFeed();
    const metrics = this.discoveryMetrics();
    const graph = this.marketGraphMetrics();
    return {
      observations: scalar("SELECT COUNT(*) AS count FROM observations"),
      vendor_leads: scalar("SELECT COUNT(*) AS count FROM leads WHERE lead_type = 'VENDOR'"),
      kol_leads: scalar("SELECT COUNT(*) AS count FROM leads WHERE lead_type = 'KOL'"),
      pending_review: scalar("SELECT COUNT(*) AS count FROM leads WHERE stage IN ('DISCOVERED','SUBMITTED','NEEDS_MORE_DATA')"),
      promotion_drafts: scalar("SELECT COUNT(*) AS count FROM promotion_drafts"),
      sources,
      live_collectors: this.liveCollectorCount(),
      source_health_percent: sources ? Math.round(healthy / sources * 100) : null,
      real_market_events: metrics.real_market_events,
      active_events: discovery.summary.active,
      upcoming_events: discovery.summary.upcoming,
      ending_soon_events: discovery.summary.ending_soon,
      needs_review_events: discovery.summary.needs_review,
      product_candidates: graph.active_products,
      vendor_candidates: graph.vendors,
      enriched_vendors: graph.vendors_enriched,
      kol_candidates: graph.kols,
      kol_product_relations: graph.kol_product_relations,
      development_prospects: graph.prospects,
      active_prospects: graph.active_prospects,
      product_matches_pending: graph.product_matches_pending,
    };
  }

  seedDemo(context = { actorRole: "SYSTEM" }) {
    if (this.db.prepare("SELECT COUNT(*) AS count FROM observations").get().count) return { seeded: false };
    const demoSource = this.createSource({ source_id: "src_demo_synthetic", name: "公開展示合成資料", type: "SYNTHETIC_DEMO", base_url: "https://example.com/", policy_status: "DEMO_ONLY", health_status: "HEALTHY", active: false }, context).source;
    const samples = [
      { entity_type: "PRODUCT", title: "輕量氣炸鍋 4.5L", product_name: "輕量氣炸鍋 4.5L", vendor_name: "森活家電（示範）", host_name: "好物研究室", category: "生活家電", platform: "公開團購頁", platform_handle: "good-life-lab", public_email: "partner@example.com", source_url: "https://example.com/groups/air-fryer", price_amount: 2990 },
      { entity_type: "VENDOR", title: "晨光食品（示範）", vendor_name: "晨光食品（示範）", host_name: "吃貨小週末", category: "食品飲料", source_url: "https://example.org/brands/morning-food", public_email: "sales@example.org" },
      { entity_type: "KOL", title: "親子慢生活", host_name: "親子慢生活", vendor_name: "沐光日用（示範）", category: "親子用品", platform: "公開合作頁", platform_handle: "slow-family", source_url: "https://example.net/creators/slow-family" },
    ];
    const results = samples.map(sample => this.createObservation({ ...sample, source_id: demoSource.source_id }, context));
    const leads = this.rebuildLeads(context);
    return { seeded: true, observations: results.length, leads };
  }
}
