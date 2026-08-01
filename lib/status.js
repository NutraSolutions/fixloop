import { timingSafeHeader } from "./validation.js";

export const MAX_STATUS_REPORTS = 50;
export const MAX_OPERATOR_REPORTS = 250;
export const MAX_STATUS_EVENTS = 100;
const REPORT_ID = /^[a-f0-9]{24}$/;
const SKIPPABLE = new Set(["received", "needs_clarification", "failed"]);
const MAX_SKIP_REASON = 500;

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
    const createdAt = new Date(decoded.createdAt);
    const publicId = parseReportId(decoded.publicId);
    if (Number.isNaN(createdAt.valueOf())) throw new Error("Invalid date");
    return { createdAt: createdAt.toISOString(), publicId };
  } catch {
    throw new Error("Invalid status cursor");
  }
}

export function operatorCursor(report) {
  if (!report) return null;
  return Buffer.from(JSON.stringify({
    createdAt: new Date(report.created_at).toISOString(),
    publicId: report.public_id
  })).toString("base64url");
}

export function publicStatusPageUrl(id, baseUrl = process.env.FIXLOOP_PUBLIC_BASE_URL) {
  const base = String(baseUrl ?? "").replace(/\/$/, "");
  return `${base || ""}/status#${encodeURIComponent(id)}`;
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
  const result = await client.query(
    `${selected}
     select
       r.public_id, r.created_at, r.updated_at, r.page_title, r.status,
       r.repository, r.github_issue_url, r.pull_request_url, r.deployment_url,
       r.resolution_summary,
       (r.status in ('received', 'needs_clarification', 'failed') or
        (r.status = 'processing' and (r.lease_until is null or r.lease_until <= now()))) as can_skip,
       coalesce(
         json_agg(
           json_build_object('status', e.status, 'detail', e.detail, 'createdAt', e.created_at)
           order by e.created_at
         ) filter (where e.id is not null),
         '[]'
       ) as events
     from ${source}
     left join lateral (
       select id, status, detail, created_at
       from fixloop.events
       where report_id = r.id
       order by created_at desc
       limit ${MAX_STATUS_EVENTS}
     ) e on true
     ${where}
     group by r.id
     ${order}`,
    filtered
      ? [filtered]
      : [MAX_OPERATOR_REPORTS + 1, cursor?.createdAt ?? null, cursor?.publicId ?? null]
  );
  return result.rows;
}

export async function skipStatusReport(client, id, reason, recordEvent) {
  const current = await client.query(
    "select id, status, lease_until, now() as current_time from fixloop.reports where public_id = $1 for update",
    [id]
  );
  if (!current.rowCount) return { outcome: "missing" };
  const report = current.rows[0];
  if (report.status === "skipped") return { outcome: "skipped", status: "skipped" };
  const expiredProcessing = report.status === "processing" && (
    report.lease_until == null || new Date(report.lease_until) <= new Date(report.current_time)
  );
  if (!SKIPPABLE.has(report.status) && !expiredProcessing) {
    return { outcome: "active", status: report.status };
  }
  await client.query(
    `update fixloop.reports
     set status = 'skipped', lease_until = null, updated_at = now()
     where id = $1`,
    [report.id]
  );
  await recordEvent(client, report.id, "skipped", `Skipped by operator: ${reason}`);
  return { outcome: "skipped", status: "skipped" };
}
