import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseReportId,
  parseReportIds,
  MAX_OPERATOR_REPORTS,
  MAX_STATUS_REPORTS,
  selectStatusReports,
  skipStatusReport,
  statusAuthorized
} from "../lib/status.js";
import { rememberReport, trackedReports, TRACKED_REPORTS_KEY } from "../public/fixloop.js";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

test("parseReportIds validates, deduplicates, and preserves order", () => {
  const first = "a".repeat(24);
  const second = "b".repeat(24);
  assert.deepEqual(parseReportIds(`${first},${second},${first}`), [first, second]);
  assert.throws(() => parseReportIds("bad-id"), /Invalid report id/);
  assert.throws(
    () => parseReportIds(Array.from({ length: MAX_STATUS_REPORTS + 1 }, (_, index) => index.toString(16).padStart(24, "0"))),
    /At most 50/
  );
});

test("parseReportId accepts exactly one bearer report id", () => {
  assert.equal(parseReportId("a".repeat(24)), "a".repeat(24));
  assert.throws(() => parseReportId("a".repeat(23)), /Invalid report id/);
});

test("rememberReport keeps a private browser-local ordered list", () => {
  const storage = new MemoryStorage();
  const first = "a".repeat(24);
  const second = "b".repeat(24);
  rememberReport({ id: first, createdAt: "2026-08-01T00:00:00.000Z" }, storage);
  rememberReport({ id: second, createdAt: "2026-08-01T00:01:00.000Z" }, storage);
  rememberReport({ id: first, createdAt: "2026-08-01T00:02:00.000Z" }, storage);
  assert.deepEqual(trackedReports(storage).map((item) => item.id), [first, second]);
  assert.equal(JSON.parse(storage.getItem(TRACKED_REPORTS_KEY)).length, 2);
});

test("trackedReports fails closed on corrupt browser storage", () => {
  const storage = new MemoryStorage();
  storage.setItem(TRACKED_REPORTS_KEY, "not-json");
  assert.deepEqual(trackedReports(storage), []);
});

test("operator list requires an exact separate status secret", () => {
  const request = { headers: { "x-fixloop-status-secret": "correct" } };
  assert.equal(statusAuthorized(request, "correct"), true);
  assert.equal(statusAuthorized(request, "wrong"), false);
  assert.equal(statusAuthorized({ headers: {} }, "correct"), false);
});

test("status report selection keeps public IDs parameterized", async () => {
  let observed;
  const client = {
    async query(text, values) {
      observed = { text, values };
      return { rows: [] };
    }
  };
  const ids = ["a".repeat(24), "b".repeat(24)];
  await selectStatusReports(client, ids);
  assert.deepEqual(observed.values, [ids]);
  assert.match(observed.text, /r\.public_id = any\(\$1::text\[\]\)/);
  assert.doesNotMatch(observed.text, new RegExp(ids[0]));
  await selectStatusReports(client);
  assert.deepEqual(observed.values, [MAX_OPERATOR_REPORTS]);
  assert.match(observed.text, /with selected as/);
  assert.match(observed.text, /limit \$1/);
});

test("operator skip retains the report and records an audit event", async () => {
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      if (queries.length === 1) return { rowCount: 1, rows: [{ id: "internal", status: "received" }] };
      return { rowCount: 1, rows: [] };
    }
  };
  const events = [];
  const result = await skipStatusReport(client, "a".repeat(24), async (...args) => events.push(args));
  assert.deepEqual(result, { outcome: "skipped", status: "skipped" });
  assert.match(queries[1].text, /set status = 'skipped'/);
  assert.deepEqual(events[0].slice(1), ["internal", "skipped", "Skipped by operator"]);
});

test("operator cannot skip active work", async () => {
  const client = {
    async query() {
      return { rowCount: 1, rows: [{ id: "internal", status: "fixing" }] };
    }
  };
  const result = await skipStatusReport(client, "b".repeat(24), () => assert.fail("event must not be written"));
  assert.deepEqual(result, { outcome: "active", status: "fixing" });
});

test("status page renders untrusted report data through textContent", () => {
  const page = fs.readFileSync(new URL("../public/status.html", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../public/status.js", import.meta.url), "utf8");
  const processor = fs.readFileSync(new URL("../api/process.js", import.meta.url), "utf8");
  const endpoint = fs.readFileSync(new URL("../api/status.js", import.meta.url), "utf8");
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.match(page, /id="reportList"/);
  assert.match(page, /id="trackingForm"/);
  assert.match(client, /node\.textContent = text/);
  assert.doesNotMatch(client, /innerHTML/);
  assert.doesNotMatch(client, /\?ids=/);
  assert.match(client, /history\.replaceState/);
  assert.match(client, /method: "DELETE"/);
  assert.match(client, /\['http:', 'https:'\]/);
  assert.match(processor, /\/status#\$\{report\.public_id\}/);
  assert.match(endpoint, /FIXLOOP_STATUS_SECRET/);
  assert.equal(vercel.cleanUrls, true);
});
