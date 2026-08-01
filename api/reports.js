import { withTransaction, addEvent } from "../lib/db.js";
import { json, method } from "../lib/http.js";
import { reportInput } from "../lib/validation.js";
import { publicStatusPageUrl } from "../lib/status.js";
import { insertReport } from "../lib/report-store.js";

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
      const inserted = await insertReport(client, input);
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
      statusPageUrl: publicStatusPageUrl(report.public_id),
      createdAt: report.created_at
    });
  } catch (error) {
    console.error("create report failed", error);
    return json(response, 500, { error: "The report could not be saved. Try again." });
  }
}

export default async function handler(request, response) {
  if (request.method === "POST") return createReport(request, response);
  return method(response, ["POST"]);
}
