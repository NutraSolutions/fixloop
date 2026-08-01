import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanPageUrl,
  cleanText,
  decodeAttachments,
  normalizeRepository,
  normalizeSenderIdentity,
  reportInput,
  senderIdentityForLog,
  timingSafeHeader,
  MAX_ATTACHMENT_BYTES
} from "../lib/validation.js";

test("cleanPageUrl removes query, fragment, and credentials", () => {
  assert.equal(
    cleanPageUrl("https://person:secret@example.test/orders/12?token=abc#private"),
    "https://example.test/orders/12"
  );
});

test("cleanPageUrl accepts http", () => {
  assert.equal(cleanPageUrl("http://localhost:3000/page?q=1"), "http://localhost:3000/page");
});

test("cleanPageUrl rejects non-web protocols", () => {
  assert.throws(() => cleanPageUrl("javascript:alert(1)"), /http or https/);
});

test("cleanText trims and strips null bytes", () => {
  assert.equal(cleanText("  hello\0  ", 10, "Text"), "hello");
});

test("cleanText rejects empty values", () => {
  assert.throws(() => cleanText(" ", 10, "Text"), /required/);
});

test("cleanText rejects oversized values", () => {
  assert.throws(() => cleanText("eleven chars", 10, "Text"), /too long/);
});

test("normalizeRepository accepts owner/name", () => {
  assert.equal(normalizeRepository("acme/store.front-end"), "acme/store.front-end");
});

test("normalizeRepository maps empty values to null", () => {
  assert.equal(normalizeRepository(""), null);
});

test("normalizeRepository rejects arbitrary URL paths", () => {
  assert.throws(() => normalizeRepository("../admin/issues"), /owner\/name/);
});

test("decodeAttachments decodes and hashes allowed content", () => {
  const [attachment] = decodeAttachments([
    {
      name: "screen.png",
      type: "image/png",
      data: "data:image/png;base64,aGVsbG8="
    }
  ]);
  assert.equal(attachment.filename, "screen.png");
  assert.equal(attachment.byteSize, 5);
  assert.equal(attachment.content.toString(), "hello");
  assert.equal(attachment.sha256.length, 64);
});

test("decodeAttachments rejects an unapproved type", () => {
  assert.throws(
    () => decodeAttachments([{ name: "run.exe", type: "application/x-msdownload", data: "data:application/x-msdownload;base64,YQ==" }]),
    /not allowed/
  );
});

test("decodeAttachments rejects mismatched declared and data MIME", () => {
  assert.throws(
    () => decodeAttachments([{ name: "a.png", type: "image/png", data: "data:image/jpeg;base64,YQ==" }]),
    /invalid data/
  );
});

test("decodeAttachments rejects too many files", () => {
  const files = Array.from({ length: 7 }, (_, index) => ({
    name: `${index}.txt`,
    type: "text/plain",
    data: "data:text/plain;base64,YQ=="
  }));
  assert.throws(() => decodeAttachments(files), /At most/);
});

test("decodeAttachments rejects a large file", () => {
  const data = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString("base64");
  assert.throws(
    () => decodeAttachments([{ name: "large.txt", type: "text/plain", data: `data:text/plain;base64,${data}` }]),
    /size limit/
  );
});

test("reportInput returns a privacy-safe normalized payload", () => {
  const result = reportInput({
    clientRequestId: "53c7f2d6-9a57-4b14-a4c4-b674a73a05ea",
    pageTitle: " Checkout ",
    pageUrl: "https://app.example.test/checkout?session=secret#payment",
    description: " Button does nothing ",
    repository: "acme/storefront",
    senderIdentity: " nostr:npub1sender\n",
    attachments: []
  });
  assert.deepEqual(result, {
    clientRequestId: "53c7f2d6-9a57-4b14-a4c4-b674a73a05ea",
    pageTitle: "Checkout",
    pageUrl: "https://app.example.test/checkout",
    description: "Button does nothing",
    requestedRepository: "acme/storefront",
    senderIdentity: "nostr:npub1sender",
    attachments: []
  });
});

test("sender identity stays optional and bounded", () => {
  assert.equal(normalizeSenderIdentity(null), null);
  assert.equal(normalizeSenderIdentity("  \n\t"), null);
  assert.equal(normalizeSenderIdentity(" Eric Stark\n<npub> "), "Eric Stark <npub>");
  assert.equal(normalizeSenderIdentity("Eric\u001bStark"), "Eric Stark");
  assert.equal(normalizeSenderIdentity("\u202Emoc.live@rekcatta"), "moc.live@rekcatta");
  assert.throws(() => normalizeSenderIdentity("x".repeat(321)), /too long/);
  assert.equal(senderIdentityForLog(null), "Not provided");
  assert.equal(senderIdentityForLog(" Eric\nStark "), "Eric Stark");
  assert.equal(reportInput({
    clientRequestId: "53c7f2d6-9a57-4b14-a4c4-b674a73a05eb",
    pageTitle: "Checkout",
    pageUrl: "https://app.example.test/checkout",
    description: "Button does nothing",
    attachments: []
  }).senderIdentity, null);
});

test("reportInput rejects a non-UUID request id", () => {
  assert.throws(() => reportInput({
    clientRequestId: "predictable",
    pageTitle: "Page",
    pageUrl: "https://example.test/page",
    description: "Broken"
  }), /must be a UUID/);
});

test("timingSafeHeader compares secrets", () => {
  assert.equal(timingSafeHeader("same-value", "same-value"), true);
  assert.equal(timingSafeHeader("same-value", "other-value"), false);
  assert.equal(timingSafeHeader("", "value"), false);
});
