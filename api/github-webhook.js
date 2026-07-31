import { createHmac, timingSafeEqual } from "node:crypto";
import { withTransaction, addEvent } from "../lib/db.js";
import { json, method } from "../lib/http.js";

export const config = {
  api: { bodyParser: false }
};

async function rawBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function signatureValid(body, signature) {
  const secret = process.env.FIXLOOP_GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export default async function handler(request, response) {
  if (request.method !== "POST") return method(response, ["POST"]);
  const body = await rawBody(request);
  if (!signatureValid(body, request.headers["x-hub-signature-256"])) {
    return json(response, 401, { error: "Invalid signature" });
  }

  const event = request.headers["x-github-event"];
  const payload = JSON.parse(body.toString("utf8"));
  const repository = payload.repository?.full_name;
  const issueNumber = payload.issue?.number;
  if (!repository || !issueNumber || event !== "issues") return json(response, 202, { ignored: true });

  const status = payload.action === "closed" ? "verified" : "filed";
  const detail = payload.action === "closed" ? "GitHub issue closed" : `GitHub issue ${payload.action}`;
  await withTransaction(async (client) => {
    const result = await client.query(
      `update fixloop.reports
       set status = $3, updated_at = now()
       where lower(repository) = lower($1) and github_issue_number = $2
       returning id`,
      [repository, issueNumber, status]
    );
    for (const row of result.rows) await addEvent(client, row.id, status, detail);
  });
  return json(response, 200, { ok: true });
}
