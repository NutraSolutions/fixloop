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
  failed: "Needs attention"
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
  article.append(timeline);
  return article;
}

async function loadReports() {
  const message = document.querySelector("#message");
  const list = document.querySelector("#reportList");
  const tracked = trackedReports();
  list.replaceChildren();
  if (!tracked.length) {
    message.textContent = "No reports saved in this browser yet.";
    message.dataset.state = "empty";
    return;
  }
  message.textContent = "Refreshing status...";
  message.dataset.state = "loading";
  try {
    const ids = tracked.map((item) => item.id).join(",");
    const response = await fetch(`/api/reports?ids=${encodeURIComponent(ids)}`, {
      headers: { Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Status failed (${response.status})`);
    for (const report of payload.reports || []) list.append(renderReport(report));
    const missing = tracked.length - (payload.reports || []).length;
    message.textContent = missing
      ? `${payload.reports.length} reports loaded. ${missing} tracking IDs were not found.`
      : `${payload.reports.length} reports loaded.`;
    message.dataset.state = "ready";
  } catch (error) {
    message.textContent = error.message || "Status is temporarily unavailable.";
    message.dataset.state = "error";
  }
}

const queryId = new URLSearchParams(location.search).get("report");
if (/^[a-f0-9]{24}$/.test(String(queryId || ""))) rememberReport({ id: queryId });

document.querySelector("#trackingForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = event.currentTarget.elements.trackingId;
  if (!input.checkValidity()) return input.reportValidity();
  rememberReport({ id: input.value });
  input.value = "";
  loadReports();
});
document.querySelector("#refresh").addEventListener("click", loadReports);
loadReports();
