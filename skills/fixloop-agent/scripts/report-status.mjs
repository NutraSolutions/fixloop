#!/usr/bin/env node

const args = process.argv.slice(2);
const reportId = args.shift();
const status = args.shift();
const detail = args.shift();
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const callbackUrl = process.env.FIXLOOP_CALLBACK_URL;
const secret = process.env.FIXLOOP_AGENT_WEBHOOK_SECRET;
if (!callbackUrl || !secret) {
  console.error("FIXLOOP_CALLBACK_URL and FIXLOOP_AGENT_WEBHOOK_SECRET are required");
  process.exit(2);
}
if (!/^[a-f0-9]{24}$/.test(reportId ?? "")) {
  console.error("A valid 24-character report id is required");
  process.exit(2);
}
if (!["assigned", "fixing", "pull_request", "deployed", "verified", "failed"].includes(status)) {
  console.error("Invalid status");
  process.exit(2);
}
if (!detail) {
  console.error("A status detail is required");
  process.exit(2);
}

const response = await fetch(callbackUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Fixloop-Secret": secret
  },
  body: JSON.stringify({
    reportId,
    status,
    detail,
    pullRequestUrl: option("--pull-request-url"),
    deploymentUrl: option("--deployment-url")
  })
});
const body = await response.text();
if (!response.ok) {
  console.error(`Fixloop callback failed (${response.status}): ${body.slice(0, 500)}`);
  process.exit(1);
}
console.log(body);
