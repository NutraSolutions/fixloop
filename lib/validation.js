import { createHash } from "node:crypto";

export const MAX_ATTACHMENTS = 6;
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = Math.floor(2.5 * 1024 * 1024);

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

export function cleanPageUrl(value) {
  const parsed = new URL(String(value));
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Page URL must use http or https");
  }
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().slice(0, 2048);
}

export function cleanText(value, max, field) {
  const text = String(value ?? "").replace(/\0/g, "").trim();
  if (!text) throw new Error(`${field} is required`);
  if (text.length > max) throw new Error(`${field} is too long`);
  return text;
}

export function normalizeRepository(value) {
  const repository = String(value ?? "").trim();
  if (!repository) return null;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("Repository must use owner/name format");
  }
  return repository;
}

export function normalizeSenderIdentity(value) {
  const identity = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/g, " ")
    .trim();
  if (!identity) return null;
  // 320 keeps common email-shaped identities within a familiar upper bound.
  if (identity.length > 320) throw new Error("Sender identity is too long");
  return identity;
}

export function senderIdentityForLog(value) {
  return normalizeSenderIdentity(value) || "Not provided";
}

export function decodeAttachments(input) {
  const attachments = Array.isArray(input) ? input : [];
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new Error(`At most ${MAX_ATTACHMENTS} attachments are allowed`);
  }

  let total = 0;
  return attachments.map((item, index) => {
    const filename = cleanText(item?.name, 180, `Attachment ${index + 1} name`).replace(/[\r\n]+/g, " ");
    const mimeType = String(item?.type ?? "").toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new Error(`Attachment type ${mimeType || "unknown"} is not allowed`);
    }
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(item?.data ?? ""));
    if (!match || match[1].toLowerCase() !== mimeType) {
      throw new Error(`Attachment ${filename} has invalid data`);
    }
    const content = Buffer.from(match[2].replace(/\s/g, ""), "base64");
    if (!content.length || content.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment ${filename} exceeds the size limit`);
    }
    total += content.length;
    if (total > MAX_TOTAL_BYTES) throw new Error("Attachments exceed the total size limit");
    return {
      filename,
      mimeType,
      byteSize: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
      content
    };
  });
}

export function reportInput(body) {
  const clientRequestId = cleanText(body?.clientRequestId, 36, "Client request id");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(clientRequestId)) {
    throw new Error("Client request id must be a UUID");
  }
  return {
    clientRequestId,
    pageTitle: cleanText(body?.pageTitle, 240, "Page title"),
    pageUrl: cleanPageUrl(body?.pageUrl),
    description: cleanText(body?.description, 8000, "Description"),
    requestedRepository: normalizeRepository(body?.repository),
    senderIdentity: normalizeSenderIdentity(body?.senderIdentity),
    attachments: decodeAttachments(body?.attachments)
  };
}

export function timingSafeHeader(actual, expected) {
  if (!actual || !expected) return false;
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length) return false;
  return createHash("sha256").update(left).digest().equals(
    createHash("sha256").update(right).digest()
  );
}
