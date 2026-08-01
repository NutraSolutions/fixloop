import { publicStatusPageUrl } from "./status.js";
import { senderIdentityForLog } from "./validation.js";

function markdownText(value) {
  return String(value).replace(/[\\`*_[\]<>]/g, "\\$&");
}

export function issueBody(report, route, baseUrl = process.env.FIXLOOP_PUBLIC_BASE_URL) {
  const statusUrl = publicStatusPageUrl(report.public_id, baseUrl, false);
  const attachmentList = report.attachments.length
    ? report.attachments.map((file) => `- ${markdownText(file.filename)} (${file.mime_type}, ${file.byte_size} bytes)`).join("\n")
    : "None";
  return [
    route.description,
    "",
    "## Source",
    `- Page: ${report.page_title}`,
    `- URL: ${report.page_url}`,
    `- Severity: ${route.severity}`,
    `- Caller-supplied sender (unverified): ${markdownText(senderIdentityForLog(report.sender_identity))}`,
    statusUrl ? `- Public status: ${statusUrl}` : null,
    "",
    "## Attachments",
    attachmentList,
    "",
    `<!-- fixloop:${report.public_id} -->`
  ].filter(Boolean).join("\n");
}
