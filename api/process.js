import { createHmac } from "node:crypto";
import { withTransaction, addEvent } from "../lib/db.js";
import { repositoryCatalog, findIssueByMarker, createIssue } from "../lib/github.js";
import { classifyReport } from "../lib/classifier.js";
import { json, method } from "../lib/http.js";
import { timingSafeHeader } from "../lib/validation.js";

const MAX_ATTEMPTS = 5;

function markdownText(value) {
  return String(value).replace(/[\\`*_[\]<>]/g, "\\$&");
}

async function claimNext() {
  return withTransaction(async (client) => {
    const selected = await client.query(
      `select *
       from fixloop.reports
       where status in ('received', 'processing')
         and (lease_until is null or lease_until < now())
         and processing_attempts < $1
       order by created_at
       for update skip locked
       limit 1`,
      [MAX_ATTEMPTS]
    );
    if (!selected.rowCount) return null;
    const report = selected.rows[0];
    await client.query(
      `update fixloop.reports
       set status = 'processing',
           processing_attempts = processing_attempts + 1,
           lease_until = now() + interval '10 minutes',
           updated_at = now()
       where id = $1`,
      [report.id]
    );
    await addEvent(client, report.id, "processing", "Routing report");
    const attachments = await client.query(
      "select filename, mime_type, byte_size, sha256, content from fixloop.attachments where report_id = $1",
      [report.id]
    );
    return { ...report, attachments: attachments.rows };
  });
}

function issueBody(report, route) {
  const base = process.env.FIXLOOP_PUBLIC_BASE_URL?.replace(/\/$/, "");
  const statusUrl = base ? `${base}/status#${report.public_id}` : null;
  const attachmentList = report.attachments.length
    ? report.attachments.map((file) => `- ${markdownText(file.filename)} (${file.mime_type}, ${file.byte_size} bytes)`).join("\n")
    : "None";
  return [
    route.description,
    "",
    "## Source",
    `- Page: ${report.page_title}`,
    `- URL: ${report.page_url}`,
    `- Severity: ${route.severity}`,
    statusUrl ? `- Public status: ${statusUrl}` : null,
    "",
    "## Attachments",
    attachmentList,
    "",
    `<!-- fixloop:${report.public_id} -->`
  ].filter(Boolean).join("\n");
}

async function dispatchAgent(report, issue, delivery = "initial") {
  const url = process.env.FIXLOOP_AGENT_WEBHOOK_URL;
  const secret = process.env.FIXLOOP_AGENT_WEBHOOK_SECRET;
  if (!url || !secret) return false;
  const body = JSON.stringify({
    deliveryId: delivery === "initial"
      ? `${report.public_id}:issue:${issue.number}`
      : `${report.public_id}:reminder:${Math.floor(Date.now() / (12 * 60 * 60 * 1000))}`,
    delivery,
    reportId: report.public_id,
    repository: report.repository,
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    callbackUrl: `${process.env.FIXLOOP_PUBLIC_BASE_URL?.replace(/\/$/, "")}/api/agent-status`
  });
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Fixloop-Signature": `sha256=${signature}`
    },
    body
  });
  if (!response.ok) throw new Error(`Agent dispatch returned ${response.status}`);
  return true;
}

async function claimReminder() {
  return withTransaction(async (client) => {
    const selected = await client.query(
      `select *
       from fixloop.reports
       where status in ('assigned', 'fixing', 'pull_request', 'deployed')
         and updated_at < now() - interval '12 hours'
         and (lease_until is null or lease_until < now())
       order by updated_at
       for update skip locked
       limit 1`
    );
    if (!selected.rowCount) return null;
    const report = selected.rows[0];
    await client.query(
      "update fixloop.reports set lease_until = now() + interval '10 minutes' where id = $1",
      [report.id]
    );
    return report;
  });
}

async function sendReminder(report) {
  try {
    const dispatched = await dispatchAgent(report, {
      number: report.github_issue_number,
      html_url: report.github_issue_url
    }, "reminder");
    await withTransaction(async (client) => {
      await client.query(
        `update fixloop.reports
         set lease_until = null, updated_at = now(), last_error = null
         where id = $1`,
        [report.id]
      );
      if (dispatched) await addEvent(client, report.id, report.status, "Fix agent reminded");
    });
    return dispatched;
  } catch (error) {
    await withTransaction(async (client) => {
      await client.query(
        "update fixloop.reports set lease_until = null, last_error = $2 where id = $1",
        [report.id, error.message.slice(0, 1000)]
      );
    });
    throw error;
  }
}

async function finalize(report, route, issue) {
  await withTransaction(async (client) => {
    await client.query(
      `update fixloop.reports
       set status = 'filed', repository = $2, severity = $3,
           github_issue_number = $4, github_issue_url = $5,
           lease_until = null, last_error = null, updated_at = now()
       where id = $1`,
      [report.id, route.repository, route.severity, issue.number, issue.html_url]
    );
    await addEvent(client, report.id, "filed", `GitHub issue #${issue.number} created in ${route.repository}`);
  });
  report.repository = route.repository;
  try {
    const dispatched = await dispatchAgent(report, issue);
    if (dispatched) {
      await withTransaction(async (client) => {
        await client.query(
          "update fixloop.reports set status = 'assigned', updated_at = now() where id = $1",
          [report.id]
        );
        await addEvent(client, report.id, "assigned", "Fix agent notified");
      });
    }
  } catch (error) {
    await withTransaction(async (client) => {
      await client.query(
        "update fixloop.reports set last_error = $2, updated_at = now() where id = $1",
        [report.id, error.message.slice(0, 1000)]
      );
      await addEvent(client, report.id, "filed", "Issue created; automatic agent dispatch needs attention");
    });
  }
}

async function markClarification(report) {
  await withTransaction(async (client) => {
    await client.query(
      `update fixloop.reports
       set status = 'needs_clarification', lease_until = null, updated_at = now()
       where id = $1`,
      [report.id]
    );
    await addEvent(client, report.id, "needs_clarification", "Choose a repository or add more detail");
  });
}

async function markFailure(report, error) {
  await withTransaction(async (client) => {
    const terminal = report.processing_attempts + 1 >= MAX_ATTEMPTS;
    await client.query(
      `update fixloop.reports
       set status = $2,
           lease_until = case when $2 = 'failed' then null else now() + interval '10 minutes' end,
           last_error = $3,
           updated_at = now()
       where id = $1`,
      [report.id, terminal ? "failed" : "processing", error.message.slice(0, 1000)]
    );
    await addEvent(
      client,
      report.id,
      terminal ? "failed" : "processing",
      terminal ? "Automatic routing failed after five attempts" : "Routing will retry"
    );
  });
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return method(response, ["GET", "POST"]);
  const bearer = String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!timingSafeHeader(bearer, process.env.CRON_SECRET)) {
    return json(response, 401, { error: "Unauthorized" });
  }

  const report = await claimNext();
  if (!report) {
    const reminder = await claimReminder();
    if (!reminder) return json(response, 200, { processed: 0 });
    try {
      const dispatched = await sendReminder(reminder);
      return json(response, 200, { processed: 0, reminded: dispatched ? 1 : 0 });
    } catch (error) {
      console.error("reminder failed", error);
      return json(response, 500, { processed: 0, error: "Reminder failed and will retry" });
    }
  }
  const catalog = await repositoryCatalog();
  try {
    const route = await classifyReport(report, report.attachments, catalog);
    if (!route) {
      await markClarification(report);
      return json(response, 200, { processed: 1, status: "needs_clarification" });
    }
    const marker = `<!-- fixloop:${report.public_id} -->`;
    const existing = await findIssueByMarker(route.repository, marker);
    const issue = existing ?? await createIssue(route.repository, {
      title: route.title,
      body: issueBody(report, route),
      labels: []
    });
    await finalize(report, route, issue);
    return json(response, 200, { processed: 1, status: "filed", issue: issue.html_url });
  } catch (error) {
    console.error("process report failed", error);
    const terminal = report.processing_attempts + 1 >= MAX_ATTEMPTS;
    if (terminal) {
      const triage = catalog.find(
        (repo) => repo.fullName.toLowerCase() === String(process.env.FIXLOOP_TRIAGE_REPOSITORY ?? "").toLowerCase()
      );
      if (triage) {
        try {
          const route = {
            repository: triage.fullName,
            title: `[Needs review] ${report.page_title}`.slice(0, 180),
            description: [
              "Automatic classification failed after five attempts.",
              "",
              report.description,
              "",
              `Last error: ${error.message}`
            ].join("\n"),
            severity: "high"
          };
          const marker = `<!-- fixloop:${report.public_id} -->`;
          const existing = await findIssueByMarker(route.repository, marker);
          const issue = existing ?? await createIssue(route.repository, {
            title: route.title,
            body: issueBody(report, route)
          });
          await finalize(report, route, issue);
          return json(response, 200, { processed: 1, status: "filed_fallback", issue: issue.html_url });
        } catch (fallbackError) {
          error = new Error(`${error.message}; fallback failed: ${fallbackError.message}`);
        }
      }
    }
    await markFailure(report, error);
    return json(response, 500, {
      processed: 1,
      error: terminal ? "Processing failed; terminal failure is visible in status" : "Processing failed and will retry"
    });
  }
}
