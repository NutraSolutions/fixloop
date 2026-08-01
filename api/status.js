import { database, withTransaction, addEvent } from "../lib/db.js";
import { json, method } from "../lib/http.js";
import {
  parseReportId,
  parseReportIds,
  operatorCursor,
  parseOperatorCursor,
  parseSkipReason,
  MAX_OPERATOR_REPORTS,
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
    let reason;
    try {
      id = parseReportId(request.body?.id);
      reason = parseSkipReason(request.body?.reason);
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
    try {
      const result = await withTransaction((client) => skipStatusReport(client, id, reason, addEvent));
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
  let cursor = null;
  if (request.body?.ids != null) {
    try {
      ids = parseReportIds(request.body.ids);
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  } else if (!statusAuthorized(request, process.env.FIXLOOP_STATUS_SECRET)) {
    return json(response, 401, { error: "Status access key required" });
  } else {
    try {
      cursor = parseOperatorCursor(request.body?.cursor);
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }

  try {
    const selected = await selectStatusReports(database(), ids, cursor);
    const reports = ids ? selected : selected.slice(0, MAX_OPERATOR_REPORTS);
    const nextCursor = !ids && selected.length > MAX_OPERATOR_REPORTS
      ? operatorCursor(reports.at(-1))
      : null;
    return json(response, 200, { reports, nextCursor });
  } catch (error) {
    console.error("list reports failed", error);
    return json(response, 500, { error: "Status is temporarily unavailable" });
  }
}
