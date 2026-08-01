import { database, withTransaction, addEvent } from "../lib/db.js";
import { json, method } from "../lib/http.js";
import {
  parseReportId,
  parseReportIds,
  selectStatusReports,
  skipStatusReport,
  statusAuthorized
} from "../lib/status.js";

export const config = {
  runtime: "nodejs"
};

export default async function handler(request, response) {
  if (!["POST", "DELETE"].includes(request.method)) return method(response, ["POST", "DELETE"]);

  if (request.method === "DELETE") {
    if (!statusAuthorized(request, process.env.FIXLOOP_STATUS_SECRET)) {
      return json(response, 401, { error: "Status access key required" });
    }
    let id;
    try {
      id = parseReportId(request.body?.id);
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
    try {
      const result = await withTransaction((client) => skipStatusReport(client, id, addEvent));
      if (result.outcome === "missing") return json(response, 404, { error: "Report not found" });
      if (result.outcome === "active") {
        return json(response, 409, { error: `Cannot skip a report while it is ${result.status}` });
      }
      return json(response, 200, { id, status: "skipped" });
    } catch (error) {
      console.error("skip report failed", error);
      return json(response, 500, { error: "The report could not be skipped" });
    }
  }

  let ids = null;
  if (request.body?.ids != null) {
    try {
      ids = parseReportIds(request.body.ids);
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  } else if (!statusAuthorized(request, process.env.FIXLOOP_STATUS_SECRET)) {
    return json(response, 401, { error: "Status access key required" });
  }

  try {
    const reports = await selectStatusReports(database(), ids);
    return json(response, 200, { reports });
  } catch (error) {
    console.error("list reports failed", error);
    return json(response, 500, { error: "Status is temporarily unavailable" });
  }
}
