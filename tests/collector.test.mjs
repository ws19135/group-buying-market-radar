import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  COLLECTOR_VERSION,
  LISTING_PARSER_VERSION,
  BABYBUYRADAR_PARSER_VERSION,
  NICKJUFU_PARSER_VERSION,
  PublicPageCollector,
  assertSourceCanCollect,
  isAllowedByRobots,
  parsePublicPage,
  parsePublicListing,
  parseBabyBuyRadarUpcoming,
  parseNickJufuCalendar,
  resolveAndValidateHost,
} from "../src/collector.mjs";

const fixture = readFileSync(fileURLToPath(new URL("../fixtures/public-group-buy.html", import.meta.url)), "utf8");
const listingFixture = readFileSync(fileURLToPath(new URL("../fixtures/public-group-buy-listing.html", import.meta.url)), "utf8");
const babyBuyRadarFixture = readFileSync(fileURLToPath(new URL("../fixtures/babybuyradar-upcoming.html", import.meta.url)), "utf8");
const nickJufuFixture = readFileSync(fileURLToPath(new URL("../fixtures/nickjufu-calendar.html", import.meta.url)), "utf8");

function approvedSource(overrides = {}) {
  return {
    source_id: "src-public",
    name: "公開團購頁",
    type: "PUBLIC_GROUP_BUY_PAGE",
    base_url: "https://market.example/group/oat",
    policy_status: "APPROVED",
    scrape_allowed: true,
    active: true,
    access_mode: "PUBLIC_NO_LOGIN",
    login_required: false,
    terms_status: "REVIEWED_PUBLIC",
    review_notes: "公開頁，不需登入",
    ...overrides,
  };
}

test("public page parser emits traceable product and KOL fields from JSON-LD", () => {
  const [record] = parsePublicPage(fixture, { sourceUrl: "https://market.example/group/oat", observedAt: "2026-11-04T12:00:00.000Z" });
  assert.equal(record.product_name, "山海燕麥脆片 6 入組");
  assert.equal(record.vendor_name, "山海食品");
  assert.equal(record.host_name, "好物研究室");
  assert.equal(record.price_amount, "1080");
  assert.equal(record.public_email, "partner@example.com");
  assert.equal(record.parser_version, COLLECTOR_VERSION);
  assert.equal(record.status, "ACTIVE_OR_RECENT");
});

test("public listing parser emits multiple product-host campaign records", () => {
  const records = parsePublicListing(listingFixture, { sourceUrl: "https://calendar.example/november", observedAt: "2026-11-04T12:00:00.000Z" });
  assert.equal(records.length, 3);
  assert.equal(records[0].product_name, "山海燕麥脆片");
  assert.equal(records[0].host_name, "小珈與泡泡");
  assert.equal(records[0].price_amount, "1080");
  assert.equal(records[0].parser_version, LISTING_PARSER_VERSION);
  assert.equal(records[2].status, "UPCOMING");
});

test("BabyBuyRadar adapter preserves product, KOL, date and original evidence link", () => {
  const records = parseBabyBuyRadarUpcoming(babyBuyRadarFixture, { sourceUrl: "https://babybuyradar.com/upcoming", observedAt: "2026-11-05T01:00:00.000Z" });
  assert.equal(records.length, 2);
  assert.equal(records[0].product_name, "Connetix 磁力積木");
  assert.equal(records[0].host_name, "雪莉與朵栗 (@dondon0813)");
  assert.equal(records[0].platform_handle, "dondon0813");
  assert.equal(records[0].source_url, "https://sheridondon.com.tw/calendar");
  assert.equal(records[0].starts_at, "2026-11-09T16:00:00.000Z");
  assert.equal(records[0].category, "玩具與學習");
  assert.equal(records[0].parser_version, BABYBUYRADAR_PARSER_VERSION);
});

test("NickJufu adapter separates active end dates and upcoming start dates", () => {
  const records = parseNickJufuCalendar(nickJufuFixture, { sourceUrl: "https://nickjufu.tw/6358/", observedAt: "2026-11-05T01:00:00.000Z" });
  assert.equal(records.length, 3);
  assert.equal(records[0].host_name, "主夫尼克 & 攸三");
  assert.equal(records[0].ends_at, "2026-11-15T15:59:59.000Z");
  assert.equal(records[0].status, "ACTIVE_OR_RECENT");
  assert.equal(records[2].starts_at, "2026-11-05T16:00:00.000Z");
  assert.equal(records[2].status, "UPCOMING");
  assert.equal(records[2].parser_version, NICKJUFU_PARSER_VERSION);
});

test("robots rules honor the longest matching path", () => {
  const robots = "User-agent: *\nDisallow: /group/\nAllow: /group/public/\n";
  assert.equal(isAllowedByRobots(robots, "/group/private"), false);
  assert.equal(isAllowedByRobots(robots, "/group/public/oat"), true);
});

test("collector checks robots and emits records from a public allowlisted page", async () => {
  const fetchImpl = async url => {
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { status: 200, headers: { "content-type": "text/plain" } });
    return new Response(fixture, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  const collector = new PublicPageCollector({
    fetchImpl,
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    sleep: async () => {},
    clock: () => new Date("2026-11-04T12:00:00.000Z"),
  });
  const result = await collector.collect(approvedSource());
  assert.equal(result.robots_status, "ALLOWED");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].source_url, "https://market.example/group/oat");
});

test("collector blocks private DNS rebinding and login-required sources", async () => {
  await assert.rejects(() => resolveAndValidateHost("market.example", async () => [{ address: "127.0.0.1", family: 4 }]), error => error.code === "SOURCE_DNS_PRIVATE_ADDRESS");
  assert.throws(() => assertSourceCanCollect(approvedSource({ login_required: true })), error => error.code === "LOGIN_REQUIRED_SOURCE_BLOCKED");
  assert.throws(() => assertSourceCanCollect(approvedSource({ terms_status: "PENDING" })), error => error.code === "SOURCE_TERMS_NOT_REVIEWED");
});
