import test from "node:test";
import assert from "node:assert/strict";
import { insertReport } from "../lib/report-store.js";

const input = {
  clientRequestId: "53c7f2d6-9a57-4b14-a4c4-b674a73a05ea",
  pageTitle: "Checkout",
  pageUrl: "https://example.test/checkout",
  description: "Button is broken",
  requestedRepository: "acme/storefront",
  senderIdentity: "user:123"
};

test("report insert stores sender identity and can backfill a missing value", async () => {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      return /insert into/.test(text)
        ? { rowCount: 1, rows: [{ public_id: "a".repeat(24) }] }
        : { rowCount: 0, rows: [] };
    }
  };
  await insertReport(client, input);
  assert.equal(calls.length, 3);
  assert.match(calls[0].text, /savepoint/);
  assert.deepEqual(calls[1].values, [...Object.values(input).slice(0, 5), input.senderIdentity]);
  assert.match(calls[1].text, /coalesce\(fixloop\.reports\.sender_identity, excluded\.sender_identity\)/);
  assert.match(calls[2].text, /release savepoint/);
});

test("pre-migration schema keeps anonymous intake working", async () => {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (/sender_identity/.test(text)) throw Object.assign(new Error("missing column"), { code: "42703" });
      return /insert into/.test(text)
        ? { rowCount: 1, rows: [{ public_id: "b".repeat(24) }] }
        : { rowCount: 0, rows: [] };
    }
  };
  const result = await insertReport(client, input);
  assert.equal(result.rows[0].public_id, "b".repeat(24));
  assert.equal(calls.length, 5);
  assert.match(calls[2].text, /rollback to savepoint/);
  assert.match(calls[3].text, /release savepoint/);
  assert.doesNotMatch(calls[4].text, /sender_identity/);
  assert.deepEqual(calls[4].values, Object.values(input).slice(0, 5));
});

test("unexpected database errors fail closed", async () => {
  const client = {
    async query(text) {
      if (/insert into/.test(text)) throw Object.assign(new Error("permission denied"), { code: "42501" });
      return { rowCount: 0, rows: [] };
    }
  };
  await assert.rejects(() => insertReport(client, input), /permission denied/);
});
