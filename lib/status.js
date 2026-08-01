import { timingSafeHeader } from "./validation.js";

export const MAX_STATUS_REPORTS = 50;
export const MAX_OPERATOR_REPORTS = 250;
const REPORT_ID = /^[a-f0-9]{24}$/;
const SKIPPABLE = new Set(["received", "needs_clarification", "failed"]);

export function parseReportId(value) {
  const id = String(value ?? "").trim();
  if (!REPORT_ID.test(id)) throw new Error("Invalid report id");
  return id;
}

export function parseReportIds(value) {
  const parts = (Array.isArray(value) ? value : [value])
    .flatMap((part) => String(part ?? "").split(","))
    .map((part) => part.trim())
    .filter(Boolean);
  const ids = [...new Set(parts)];
  if (!ids.length) throw new Error("At least one report id is required");
  if (ids.length > MAX_STATUS_REPORTS) {
    throw new Error(`At most ${MAX_STATUS_REPORTS} report ids are allowed`);
  }
  ids.forEach(parseReportId);
  return ids;
}

export function statusAuthorized(request, expected) {
  return timingSafeHeader(request.headers?.["x-fixloop-status-secret"], expected);
}

export async function selectStatusReports(client, ids = null) {
  const filtered = Array.isArray(ids) ? ids : null;
  const selected = filtered
    ? ""
    : `with selected as (
         select id from fixloop.reports order by created_at desc limit $1
       )`;
  const source = filtered
    ? "fixloop.reports r"
    : "selected s join fixloop.reports r on r.id = s.id";
  const where = filtered ? "where r.public_id = any($1::text[])" : "";
  const order = filtered ? "order by array_position($1::text[], r.public_id)" : "order by r.created_at desc";
  const result = await client.query(
    `${selected}
     select
       r.public_id, r.created_at, r.updated_at, r.page_title, r.status,
       r.repository, r.github_issue_url, r.pull_request_url, r.deployment_url,
       r.resolution_summary,
       coalesce(
         json_agg(
           json_build_object('status', e.status, 'detail', e.detail, 'createdAt', e.created_at)
           order by e.created_at
         ) filter (where e.id is not null),
         '[]'
       ) as events
     from ${source}
     left join fixloop.events e on e.report_id = r.id
     ${where}
     group by r.id
     ${order}`,
    filtered ? [filtered] : [MAX_OPERATOR_REPORTS]
  );
  return result.rows;
}

export async function skipStatusReport(client, id, recordEvent) {
  const current = await client.query(
    "select id, status from fixloop.reports where public_id = $1 for update",
    [id]
  );
  if (!current.rowCount) return { outcome: "missing" };
  const report = current.rows[0];
  if (report.status === "skipped") return { outcome: "skipped", status: "skipped" };
  if (!SKIPPABLE.has(report.status)) return { outcome: "active", status: report.status };
  await client.query(
    `update fixloop.reports
     set status = 'skipped', lease_until = null, updated_at = now()
     where id = $1`,
    [report.id]
  );
  await recordEvent(client, report.id, "skipped", "Skipped by operator");
  return { outcome: "skipped", status: "skipped" };
}
