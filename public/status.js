import { rememberReport, trackedReports } from "./fixloop.js";

const STATUS_LABELS = Object.freeze({
  received: "Received",
  processing: "Routing",
  needs_clarification: "Needs clarification",
  filed: "Issue filed",
  assigned: "Agent assigned",
  fixing: "Fix in progress",
  pull_request: "Pull request",
  deployed: "Deployed",
  verified: "Verified",
  failed: "Needs attention",
  skipped: "Skipped"
});

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown time" : new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function safeLink(url, label) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    const anchor = element("a", "report-link", label);
    anchor.href = parsed.toString();
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    return anchor;
  } catch {
    return null;
  }
}

function renderReport(report) {
  const article = element("article", "report-card");
  const header = element("header", "report-header");
  const titleWrap = element("div");
  titleWrap.append(
    element("p", "report-id", report.public_id),
    element("h3", "report-title", report.page_title || "Untitled report")
  );
  const status = element("span", `status status--${report.status}`, STATUS_LABELS[report.status] || report.status);
  header.append(titleWrap, status);

  const meta = element("dl", "report-meta");
  for (const [label, value] of [
    ["Submitted", formatDate(report.created_at)],
    ["Updated", formatDate(report.updated_at)],
    ["Repository", report.repository || "Routing not complete"]
  ]) {
    meta.append(element("dt", "", label), element("dd", "", value));
  }

  const links = element("div", "report-links");
  for (const link of [
    safeLink(report.github_issue_url, "GitHub issue"),
    safeLink(report.pull_request_url, "Pull request"),
    safeLink(report.deployment_url, "Deployment")
  ].filter(Boolean)) links.append(link);

  const timeline = element("ol", "timeline");
  for (const event of report.events || []) {
    const item = element("li");
    const line = element("div", "timeline-line");
    line.append(
      element("strong", "", STATUS_LABELS[event.status] || event.status),
      element("time", "", formatDate(event.createdAt))
    );
    item.append(line, element("p", "", event.detail || "Status updated"));
    timeline.append(item);
  }

  article.append(header, meta);
  if (links.childElementCount) article.append(links);
  if (report.resolution_summary) article.append(element("p", "resolution", report.resolution_summary));
  if (operatorKey && ["received", "needs_clarification", "failed"].includes(report.status)) {
    const button = element("button", "skip-report", "Skip report");
    button.type = "button";
    button.dataset.reportId = report.public_id;
    article.append(button);
  }
  article.append(timeline);
  return article;
}

let operatorKey = null;

async function loadReports() {
  const message = document.querySelector("#message");
  const list = document.querySelector("#reportList");
  const tracked = trackedReports();
  list.replaceChildren();
  if (!tracked.length && !operatorKey) {
    message.textContent = "No reports saved in this browser yet.";
    message.dataset.state = "empty";
    return;
  }
  message.textContent = "Refreshing status...";
  message.dataset.state = "loading";
  try {
    const response = await fetch("/api/status", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(operatorKey ? { "X-Fixloop-Status-Secret": operatorKey } : {})
      },
      body: JSON.stringify(operatorKey ? {} : { ids: tracked.map((item) => item.id) })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Status failed (${response.status})`);
    const reports = Array.isArray(payload.reports) ? payload.reports : [];
    for (const report of reports) list.append(renderReport(report));
    const missing = operatorKey ? 0 : tracked.length - reports.length;
    message.textContent = missing
      ? `${reports.length} reports loaded. ${missing} tracking IDs were not found.`
      : `${reports.length} reports loaded.`;
    message.dataset.state = "ready";
  } catch (error) {
    message.textContent = error.message || "Status is temporarily unavailable.";
    message.dataset.state = "error";
  }
}

let fragmentId = "";
try {
  fragmentId = decodeURIComponent(location.hash.slice(1));
} catch {
  fragmentId = "";
}
if (/^[a-f0-9]{24}$/.test(fragmentId)) {
  rememberReport({ id: fragmentId });
  history.replaceState(null, "", `${location.pathname}${location.search}`);
}

document.querySelector("#trackingForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = event.currentTarget.elements.trackingId;
  if (!input.checkValidity()) return input.reportValidity();
  rememberReport({ id: input.value });
  input.value = "";
  loadReports();
});
document.querySelector("#refresh").addEventListener("click", loadReports);
document.querySelector("#reportList").addEventListener("click", async (event) => {
  const button = event.target.closest(".skip-report");
  if (!button || !operatorKey) return;
  button.disabled = true;
  try {
    const response = await fetch("/api/status", {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Fixloop-Status-Secret": operatorKey
      },
      body: JSON.stringify({ id: button.dataset.reportId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Skip failed (${response.status})`);
    await loadReports();
  } catch (error) {
    const message = document.querySelector("#message");
    message.textContent = error.message || "The report could not be skipped.";
    message.dataset.state = "error";
    button.disabled = false;
  }
});
document.querySelector("#operatorForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = event.currentTarget.elements.statusKey;
  operatorKey = input.value;
  input.value = "";
  loadReports();
});
loadReports();
