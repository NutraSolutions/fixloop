import { withTransaction, addEvent } from "../lib/db.js";
import { json, method } from "../lib/http.js";
import { timingSafeHeader } from "../lib/validation.js";

const STATUS = new Set(["assigned", "fixing", "pull_request", "deployed", "verified", "failed"]);

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
  const detail = String(request.body?.detail ?? "").slice(0, 1000) || null;
  const pullRequestUrl = request.body?.pullRequestUrl ? String(request.body.pullRequestUrl).slice(0, 2048) : null;
  const deploymentUrl = request.body?.deploymentUrl ? String(request.body.deploymentUrl).slice(0, 2048) : null;
  try {
    const found = await withTransaction(async (client) => {
      const result = await client.query(
        `update fixloop.reports
         set status = $2,
             pull_request_url = coalesce($3, pull_request_url),
             deployment_url = coalesce($4, deployment_url),
             resolution_summary = case when $2 = 'verified' then $5 else resolution_summary end,
             updated_at = now()
         where public_id = $1
         returning id`,
        [reportId, status, pullRequestUrl, deploymentUrl, detail]
      );
      if (!result.rowCount) return false;
      await addEvent(client, result.rows[0].id, status, detail);
      return true;
    });
    if (!found) return json(response, 404, { error: "Report not found" });
    return json(response, 200, { ok: true });
  } catch (error) {
    console.error("agent status failed", error);
    return json(response, 500, { error: "Status update failed" });
  }
}
