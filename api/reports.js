import { database, withTransaction, addEvent } from "../lib/db.js";
import { json, method } from "../lib/http.js";
import { reportInput } from "../lib/validation.js";

export const config = {
  api: { bodyParser: { sizeLimit: "4mb" } }
};

async function createReport(request, response) {
  let input;
  try {
    input = reportInput(request.body);
  } catch (error) {
    return json(response, 400, { error: error.message });
  }

  try {
    const report = await withTransaction(async (client) => {
      const inserted = await client.query(
        `insert into fixloop.reports
          (client_request_id, page_title, page_url, description, requested_repository)
         values ($1, $2, $3, $4, $5)
         on conflict (client_request_id)
         do update set client_request_id = excluded.client_request_id
         returning id, public_id, status, created_at`,
        [
          input.clientRequestId,
          input.pageTitle,
          input.pageUrl,
          input.description,
          input.requestedRepository
        ]
      );
      const row = inserted.rows[0];
      for (const attachment of input.attachments) {
        await client.query(
          `insert into fixloop.attachments
            (report_id, filename, mime_type, byte_size, sha256, content)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (report_id, sha256) do nothing`,
          [
            row.id,
            attachment.filename,
            attachment.mimeType,
            attachment.byteSize,
            attachment.sha256,
            attachment.content
          ]
        );
      }
      await addEvent(client, row.id, "received", "Report accepted");
      return row;
    });
    return json(response, 201, {
      id: report.public_id,
      status: report.status,
      statusUrl: `/api/reports?id=${report.public_id}`,
      createdAt: report.created_at
    });
  } catch (error) {
    console.error("create report failed", error);
    return json(response, 500, { error: "The report could not be saved. Try again." });
  }
}

async function getReport(request, response) {
  const id = String(request.query?.id ?? "");
  if (!/^[a-f0-9]{24}$/.test(id)) return json(response, 400, { error: "Invalid report id" });
  try {
    const result = await database().query(
      `select
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
       from fixloop.reports r
       left join fixloop.events e on e.report_id = r.id
       where r.public_id = $1
       group by r.id`,
      [id]
    );
    if (!result.rowCount) return json(response, 404, { error: "Report not found" });
    return json(response, 200, result.rows[0]);
  } catch (error) {
    console.error("get report failed", error);
    return json(response, 500, { error: "Status is temporarily unavailable" });
  }
}

export default async function handler(request, response) {
  if (request.method === "POST") return createReport(request, response);
  if (request.method === "GET") return getReport(request, response);
  return method(response, ["GET", "POST"]);
}
