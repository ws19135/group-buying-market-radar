import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RadarDatabase } from "../src/database.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const databaseArgument = process.argv.find(value => value.startsWith("--database="))?.slice("--database=".length);
const databaseFile = resolve(databaseArgument || join(ROOT, ".data", "market-radar.sqlite"));
const database = new RadarDatabase(databaseFile);

try {
  const result = database.rebuildMarketGraph({ actorRole: "SYSTEM_ADMIN", requestId: `m6-rebuild-${Date.now()}` });
  console.log(JSON.stringify({ completed_at: new Date().toISOString(), database_file: databaseFile, ...result }, null, 2));
} finally {
  database.close();
}
