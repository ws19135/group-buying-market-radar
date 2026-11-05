import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicPageCollector } from "../src/collector.mjs";
import { RadarDatabase } from "../src/database.mjs";
import { sha256 } from "../src/domain.mjs";
import { M2_APPROVED_SOURCES } from "../src/m2-sources.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const databaseArgument = process.argv.find(value => value.startsWith("--database="))?.slice("--database=".length);
const force = process.argv.includes("--force");
const databaseFile = resolve(databaseArgument || join(ROOT, ".data", "market-radar.sqlite"));
const database = new RadarDatabase(databaseFile);
const collector = new PublicPageCollector({ timeoutMs: 30_000 });
const context = { actorRole: "SYSTEM_ADMIN", requestId: `m2-uat-${Date.now()}` };

try {
  const seeded = database.seedApprovedSources(M2_APPROVED_SOURCES, context);
  const collections = [];
  for (const source of seeded.sources) {
    if (!force && source.last_success_at) {
      const nextAllowedAt = new Date(source.last_success_at).getTime() + Number(source.collection_interval_minutes || 1440) * 60_000;
      if (Date.now() < nextAllowedAt) {
        collections.push({ source_id: source.source_id, name: source.name, status: "SKIPPED_RATE_LIMIT", next_allowed_at: new Date(nextAllowedAt).toISOString() });
        continue;
      }
    }
    const result = await collector.collect(source);
    const imported = database.importObservations(result.records, {
      sourceId: source.source_id,
      idempotencyKey: sha256({ source_id: source.source_id, content_hash: result.content_hash, parser_version: result.parser_version }),
      allowEmpty: true,
      runMetadata: {
        target_url: result.fetched_url,
        parser_version: result.parser_version,
        content_hash: result.content_hash,
        fetched_at: result.observed_at,
      },
      ...context,
    });
    database.markCollectionSuccess(source.source_id, { robotsStatus: result.robots_status, robotsCheckedAt: result.robots_checked_at }, context);
    collections.push({
      source_id: source.source_id,
      name: source.name,
      parser_version: result.parser_version,
      emitted_count: result.records.length,
      created_count: imported.run.created_count,
      duplicate_count: imported.run.duplicate_count,
      error_count: imported.run.error_count,
      status: imported.run.status,
      replayed: imported.replayed,
      robots_status: result.robots_status,
    });
  }
  database.rebuildLeads(context);
  const marketGraph = database.rebuildMarketGraph(context);
  const metrics = database.discoveryMetrics();
  const feed = database.discoveryFeed();
  const precisionEligible = feed.items.filter(item => item.confidence >= 0.9 && item.product_name && item.host_name && item.source_url && (item.starts_at || item.ends_at));
  const structuralPrecision = feed.items.length ? Math.round(precisionEligible.length / feed.items.length * 10_000) / 100 : 0;
  const report = {
    completed_at: new Date().toISOString(),
    database_file: databaseFile,
    collections,
    metrics,
    market_graph: marketGraph,
    feed_summary: feed.summary,
    structural_precision_percent: structuralPrecision,
    gate_b: {
      two_sources: metrics.successful_sources >= 2,
      at_least_30_events: metrics.real_market_events >= 30,
      structural_precision_at_least_80: structuralPrecision >= 80,
      passed: metrics.successful_sources >= 2 && metrics.real_market_events >= 30 && structuralPrecision >= 80,
    },
    note: "structural_precision 為必填欄位與可追溯連結的自動檢查；人工抽樣結果另記錄於 docs/M2_UAT_EVIDENCE.md。",
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.gate_b.passed) process.exitCode = 2;
} catch (error) {
  console.error(JSON.stringify({ error: { code: error.code || "M2_UAT_FAILED", message: error.message } }, null, 2));
  process.exitCode = 1;
} finally {
  database.close();
}
