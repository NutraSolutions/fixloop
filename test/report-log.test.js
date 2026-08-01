import test from "node:test";
import assert from "node:assert/strict";
import { issueBody } from "../lib/report-log.js";

const baseReport = {
  public_id: "a".repeat(24),
  page_title: "Checkout",
  page_url: "https://example.test/checkout",
  sender_identity: null,
  attachments: []
};
const route = { description: "Button is broken", severity: "normal" };

test("issue log labels sender identity as caller-supplied and unverified", () => {
  const body = issueBody(
    { ...baseReport, sender_identity: "Eric Stark" },
    route,
    "https://bugs.example.test"
  );
  assert.match(body, /- Caller-supplied sender \(unverified\): Eric Stark/);
  assert.doesNotMatch(body, /\n- Sender: Eric Stark/);
});

test("issue log preserves anonymous compatibility", () => {
  const body = issueBody(baseReport, route, "https://bugs.example.test");
  assert.match(body, /- Caller-supplied sender \(unverified\): Not provided/);
});

test("issue log neutralizes sender Markdown and line injection", () => {
  const body = issueBody(
    { ...baseReport, sender_identity: "**Eric**\n<script>alert(1)</script>" },
    route,
    "https://bugs.example.test"
  );
  assert.match(body, /\\\*\\\*Eric\\\*\\\* \\<script\\\>alert\(1\)\\<\/script\\\>/);
  assert.doesNotMatch(body, /\n<script>/);
});
