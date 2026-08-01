import { timingSafeHeader } from "./validation.js";

export const MAX_STATUS_REPORTS = 50;
export const MAX_OPERATOR_REPORTS = 250;
export const MAX_STATUS_EVENTS = 100;
const REPORT_ID = /^[a-f0-9]{24}$/;
const SKIPPABLE = new Set(["received", "needs_clarification", "failed"]);
const MAX_SKIP_REASON = 500;
const AGENT_STATUS_RANK = new Map([
  ["filed", 0],
  ["assigned", 1],
  ["fixing", 2],
  ["pull_request", 3],
  ["deployed", 4],
  ["verified", 5]
]);

export function agentStatusTransition(currentStatus, nextStatus) {
  if (["verified", "failed", "skipped"].includes(currentStatus)) return "terminal";
  if (nextStatus !== "failed" && (AGENT_STATUS_RANK.get(nextStatus) ?? -1) < (AGENT_STATUS_RANK.get(currentStatus) ?? -1)) {
    return "regression";
  }
  return "update";
}

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

export function parseSkipReason(value) {
  const reason = String(value ?? "").replace(/\0/g, "").trim();
  if (!reason) throw new Error("Skip reason is required");
  if (reason.length > MAX_SKIP_REASON) throw new Error(`Skip reason must be ${MAX_SKIP_REASON} characters or fewer`);
  return reason;
}

export function parseOperatorCursor(value) {
  if (value == null || value === "") return null;
  try {
    const decoded = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    const createdAt = String(decoded.createdAt ?? "");
    const publicId = parseReportId(decoded.publicId);
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(createdAt)) {
      throw new Error("Invalid date");
    }
    return { createdAt, publicId };
  } catch {
    throw new Error("Invalid status cursor");
  }
}

export function operatorCursor(report) {
  if (!report) return null;
  return Buffer.from(JSON.stringify({
    createdAt: report.cursor_created_at || new Date(report.created_at).toISOString(),
    publicId: report.public_id
  })).toString("base64url");
}

export function publicStatusPageUrl(
  id,
  baseUrl = process.env.FIXLOOP_PUBLIC_BASE_URL,
  allowRelative = true
) {
  const base = String(baseUrl ?? "").replace(/\/$/, "");
  const relative = `/status#${encodeURIComponent(id)}`;
  if (!base) return allowRelative ? relative : null;
  try {
    const parsed = new URL(base);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported status origin");
    parsed.search = "";
    parsed.hash = "";
    return `${parsed.href.replace(/\/$/, "")}/status#${encodeURIComponent(id)}`;
  } catch {
    return allowRelative ? relative : null;
  }
}

export async function selectStatusReports(client, ids = null, cursor = null) {
  const filtered = Array.isArray(ids) ? ids : null;
  const selected = filtered
    ? ""
    : `with selected as (
         select id from fixloop.reports
         where ($2::timestamptz is null or (created_at, public_id) < ($2::timestamptz, $3::text))
         order by created_at desc, public_id desc
         limit $1
       )`;
  const source = filtered
    ? "fixloop.reports r"
    : "selected s join fixloop.reports r on r.id = s.id";
  const where = filtered ? "where r.public_id = any($1::text[])" : "";
  const order = filtered
    ? "order by array_position($1::text[], r.public_id)"
    : "order by r.created_at desc, r.public_id desc";
  const eventLimit = filtered ? "$2" : "$4";
  const result = await client.query(
    `${selected}
     select
       r.public_id, r.created_at, r.updated_at, r.page_title, r.status,
       r.repository, r.github_issue_url, r.pull_request_url, r.deployment_url,
       r.resolution_summary,
       ${filtered ? "" : "r.created_at::text as cursor_created_at,"}
       r.status in ('received', 'needs_clarification', 'failed') as can_skip,
       coalesce(
         json_agg(
           json_build_object('status', e.status, 'detail', e.detail, 'createdAt', e.created_at)
           order by e.created_at, e.id
         ) filter (where e.id is not null),
         '[]'
       ) as events,
       coalesce(max(e.total_count), 0)::integer as event_count
     from ${source}
     left join lateral (
       select id, status, detail, created_at, count(*) over () as total_count
       from fixloop.events
       where report_id = r.id
       order by created_at desc, id desc
       limit ${eventLimit}
     ) e on true
     ${where}
     group by r.id
     ${order}`,
    filtered
      ? [filtered, MAX_STATUS_EVENTS]
      : [MAX_OPERATOR_REPORTS + 1, cursor?.createdAt ?? null, cursor?.publicId ?? null, MAX_STATUS_EVENTS]
  );
  return result.rows;
}

export async function skipStatusReport(client, id, reason, recordEvent) {
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
  await recordEvent(client, report.id, "skipped", `Skipped by operator: ${reason}`);
  return { outcome: "skipped", status: "skipped" };
}
