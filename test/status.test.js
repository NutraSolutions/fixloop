import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseReportIds, MAX_STATUS_REPORTS } from "../lib/status.js";
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

test("status page renders untrusted report data through textContent", () => {
  const page = fs.readFileSync(new URL("../public/status.html", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../public/status.js", import.meta.url), "utf8");
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.match(page, /id="reportList"/);
  assert.match(page, /id="trackingForm"/);
  assert.match(client, /node\.textContent = text/);
  assert.doesNotMatch(client, /innerHTML/);
  assert.match(client, /\['http:', 'https:'\]/);
  assert.equal(vercel.cleanUrls, true);
});
