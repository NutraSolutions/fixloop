import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ALLOWED_ATTACHMENT_TYPES, retryableStatus } from "../public/fixloop.js";

test("client attachment types mirror the server contract", () => {
  assert.equal(ALLOWED_ATTACHMENT_TYPES.has("image/png"), true);
  assert.equal(ALLOWED_ATTACHMENT_TYPES.has("application/pdf"), true);
  assert.equal(ALLOWED_ATTACHMENT_TYPES.has("application/x-msdownload"), false);
  assert.equal(ALLOWED_ATTACHMENT_TYPES.has(""), false);
});

test("network-pressure HTTP statuses remain retryable", () => {
  assert.equal(retryableStatus(408), true);
  assert.equal(retryableStatus(429), true);
  assert.equal(retryableStatus(500), true);
  assert.equal(retryableStatus(503), true);
});

test("permanent client errors are not retried", () => {
  assert.equal(retryableStatus(400), false);
  assert.equal(retryableStatus(401), false);
  assert.equal(retryableStatus(413), false);
  assert.equal(retryableStatus(415), false);
  assert.equal(retryableStatus(422), false);
});

test("sender identity reaches durable intake and downstream logs", () => {
  const widget = fs.readFileSync(new URL("../public/fixloop.js", import.meta.url), "utf8");
  const store = fs.readFileSync(new URL("../lib/report-store.js", import.meta.url), "utf8");
  const processor = fs.readFileSync(new URL("../api/process.js", import.meta.url), "utf8");
  const issueLog = fs.readFileSync(new URL("../lib/report-log.js", import.meta.url), "utf8");
  const schema = fs.readFileSync(new URL("../sql/schema.sql", import.meta.url), "utf8");
  const migration = fs.readFileSync(new URL("../sql/003_sender_identity.sql", import.meta.url), "utf8");
  assert.match(widget, /senderIdentity: this\.options\.senderIdentity \|\| null/);
  assert.match(store, /sender_identity = coalesce\(fixloop\.reports\.sender_identity, excluded\.sender_identity\)/);
  assert.match(issueLog, /Caller-supplied sender \(unverified\):.*senderIdentityForLog/);
  assert.match(processor, /senderIdentity: report\.sender_identity \|\| null/);
  assert.match(processor, /senderIdentitySource: report\.sender_identity \? "caller" : null/);
  assert.match(schema, /sender_identity text/);
  assert.match(migration, /add column if not exists sender_identity text/);
});
