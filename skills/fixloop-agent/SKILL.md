---
name: fixloop-agent
description: Claim and complete software bug reports created by Fixloop. Use when a task contains a Fixloop report ID or GitHub issue and requires implementation, verification, pull request creation, deployment, and callback status updates without losing the original reporter's context.
---

# Fixloop Agent

Turn one Fixloop issue into a verified, reported fix. Preserve the report-to-issue link, work in the repository named by the dispatch payload, and update Fixloop at material lifecycle boundaries.

## Required Inputs

- `reportId`
- `repository`
- `issueNumber` or `issueUrl`
- `callbackUrl`
- `FIXLOOP_AGENT_WEBHOOK_SECRET` in the environment

Never request or print the secret.

## Workflow

1. Read the GitHub issue, linked screenshots, and nearby repository guidance.
2. Confirm the repository in the dispatch payload matches the issue URL. Stop on mismatch.
3. Post `fixing` with a short implementation intent:

   ```bash
   node scripts/report-status.mjs REPORT_ID fixing "Fix started"
   ```

4. Inspect the actual call path and neighboring conventions before editing.
5. Create or reuse a dedicated branch or worktree. Preserve unrelated changes.
6. Reproduce the failure when practical. Add a regression test that fails for the reported case.
7. Implement the smallest complete fix.
8. Run the full package test suite and required project gates.
9. Self-review the diff for secrets, debug code, accidental files, and missing boundary handling.
10. Commit with the repository's required identity and trailers. Push and open a pull request.
11. Post `pull_request` with the PR URL:

    ```bash
    node scripts/report-status.mjs REPORT_ID pull_request "Full test suite passed" \
      --pull-request-url https://github.com/owner/repo/pull/123
    ```

12. Deploy only when the task and repository policy authorize it.
13. Post `deployed` with the deployment URL.
14. Verify the original failing workflow in the deployed environment.
15. Post `verified` only after the deployed workflow passes. Include the observable result.

## Failure Contract

- Never mark `verified` from unit tests alone.
- Never silently stop after claiming work.
- Post `failed` only for a terminal blocker. Include the exact missing authority, external dependency, or reproducible error.
- Keep temporary CI failures in the work log. Do not mark the report failed while another safe route remains.
- If issue details are insufficient, ask on the GitHub issue and post `failed` with `Needs reporter clarification`.

## Status Commands

Run commands from this skill directory or pass `FIXLOOP_CALLBACK_URL`:

```bash
export FIXLOOP_CALLBACK_URL=https://bugs.example.com/api/agent-status
node scripts/report-status.mjs REPORT_ID fixing "Regression reproduced"
```

See `references/issue-contract.md` for the issue marker, status model, and payload contract.

## Completion Evidence

The final callback detail must state:

- exact test or verification performed;
- pull request URL;
- deployment URL when deployed;
- whether the original report is fixed;
- any remaining limitation.
