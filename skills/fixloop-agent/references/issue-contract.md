# Fixloop issue contract

Every GitHub issue created by Fixloop contains:

```html
<!-- fixloop:PUBLIC_REPORT_ID -->
```

Treat that marker as immutable. It provides idempotency and connects GitHub events to the original report.

## Status transitions

```text
received
  -> processing
  -> needs_clarification
  -> filed
  -> assigned
  -> fixing
  -> pull_request
  -> deployed
  -> verified
```

`failed` is terminal and must include a precise blocker.

## Agent callback

```http
POST /api/agent-status
X-Fixloop-Secret: shared-secret
Content-Type: application/json
```

```json
{
  "reportId": "24-character-public-id",
  "status": "pull_request",
  "detail": "Regression test and full package suite passed",
  "pullRequestUrl": "https://github.com/owner/repository/pull/123",
  "deploymentUrl": null
}
```

The endpoint never accepts repository or issue-number changes. Those fields are fixed during intake.
