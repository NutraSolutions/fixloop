import test from "node:test";
import assert from "node:assert/strict";
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
