import { withTransaction, addEvent } from "../lib/db.js";
import { json, method } from "../lib/http.js";
import { timingSafeHeader } from "../lib/validation.js";

const STATUS = new Set(["assigned", "fixing", "pull_request", "deployed", "verified", "failed"]);
const RANK = new Map([
  ["filed", 0],
  ["assigned", 1],
  ["fixing", 2],
  ["pull_request", 3],
  ["deployed", 4],
  ["verified", 5]
]);

function optionalHttpUrl(value, field) {
  if (!value) return null;
  const parsed = new URL(String(value));
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`${field} must use http or https`);
  return parsed.toString().slice(0, 2048);
}

export default async function handler(request, response) {
  if (request.method !== "POST") return method(response, ["POST"]);
  if (!timingSafeHeader(request.headers["x-fixloop-secret"], process.env.FIXLOOP_AGENT_WEBHOOK_SECRET)) {
    return json(response, 401, { error: "Unauthorized" });
  }
  const reportId = String(request.body?.reportId ?? "");
  const status = String(request.body?.status ?? "");
  if (!/^[a-f0-9]{24}$/.test(reportId) || !STATUS.has(status)) {
    return json(response, 400, { error: "Invalid status update" });
  }
  const detail = String(request.body?.detail ?? "").trim().slice(0, 1000);
  if (!detail) return json(response, 400, { error: "Status detail is required" });
  let pullRequestUrl;
  let deploymentUrl;
  try {
    pullRequestUrl = optionalHttpUrl(request.body?.pullRequestUrl, "Pull request URL");
    deploymentUrl = optionalHttpUrl(request.body?.deploymentUrl, "Deployment URL");
  } catch (error) {
    return json(response, 400, { error: error.message });
  }
  try {
    const outcome = await withTransaction(async (client) => {
      const selected = await client.query(
        "select id, status from fixloop.reports where public_id = $1 for update",
        [reportId]
      );
      if (!selected.rowCount) return "not_found";
      const current = selected.rows[0];
      if (["verified", "failed"].includes(current.status)) return "terminal";
      if (status !== "failed" && (RANK.get(status) ?? -1) < (RANK.get(current.status) ?? -1)) {
        return "regression";
      }
      await client.query(
        `update fixloop.reports
         set status = $2,
             pull_request_url = coalesce($3, pull_request_url),
             deployment_url = coalesce($4, deployment_url),
             resolution_summary = case when $2 = 'verified' then $5 else resolution_summary end,
             updated_at = now()
         where id = $1`,
        [current.id, status, pullRequestUrl, deploymentUrl, detail]
      );
      await addEvent(client, current.id, status, detail);
      return "updated";
    });
    if (outcome === "not_found") return json(response, 404, { error: "Report not found" });
    if (outcome === "terminal") return json(response, 409, { error: "Terminal report status cannot change" });
    if (outcome === "regression") return json(response, 409, { error: "Report status cannot move backward" });
    return json(response, 200, { ok: true });
  } catch (error) {
    console.error("agent status failed", error);
    return json(response, 500, { error: "Status update failed" });
  }
}
