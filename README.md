# Fixloop

Fixloop is a portable bug-to-fix loop for any web application:

1. A floating in-product widget captures the page context, description, clipboard screenshots, images, PDFs, and documents.
2. An IndexedDB outbox retries until the durable intake API confirms storage.
3. A scheduled processor routes the report only to a repository from a live GitHub allowlist.
4. GitHub receives an idempotent issue.
5. An optional agent webhook starts the fix.
6. Agent and GitHub callbacks build a public status timeline through verification.

No reporter identity is collected. Query strings, URL fragments, credentials, and browser fingerprints are excluded by default.

## Demo

Open `public/index.html` through any local static server. The floating button is in the lower-right corner.

```bash
npx serve public
```

## Install the widget

Copy `public/fixloop.js` and `public/fixloop.css` into your application, then mount it:

```html
<script type="module">
  import { mountFixloop } from "/fixloop/fixloop.js";

  mountFixloop({
    endpoint: "/api/reports",
    repositories: [
      { value: "acme/storefront", label: "Storefront" },
      { value: "acme/api", label: "API" }
    ]
  });
</script>
```

The repository selector is optional. Leaving it out lets the processor classify the destination from the live catalog. Unknown destinations stop for clarification instead of filing in the wrong repository.

## Deploy the backend

The included serverless functions target Vercel and Postgres.

1. Create a Postgres database.
2. Apply `sql/schema.sql`.
3. Copy `.env.example` to `.env.local` and set the variables.
4. Deploy the repository to Vercel.
5. Add a GitHub webhook pointing to `https://YOUR_DOMAIN/api/github-webhook`.
6. Select the `Issues` event and use `FIXLOOP_GITHUB_WEBHOOK_SECRET`.
7. Call `GET /api/process` with `Authorization: Bearer CRON_SECRET` for a smoke test.

Vercel Cron calls `/api/process` every ten minutes. Vercel sends `CRON_SECRET` as a bearer token when the project variable is configured.

## GitHub token permissions

Use a fine-grained token owned by a machine account:

| Permission | Access |
|---|---|
| Metadata | Read |
| Issues | Read and write |
| Contents | None |
| Pull requests | None |
| Actions | None |
| Administration | None |

Limit repository access with `FIXLOOP_REPOSITORIES` when the token can see more repositories than Fixloop should route to.

## Agent integration

Set `FIXLOOP_AGENT_WEBHOOK_URL` and `FIXLOOP_AGENT_WEBHOOK_SECRET`. Fixloop signs the raw JSON body:

```text
X-Fixloop-Signature: sha256=HEX_HMAC_SHA256
```

The receiver gets:

```json
{
  "reportId": "24-character-public-id",
  "repository": "owner/name",
  "issueNumber": 42,
  "issueUrl": "https://github.com/owner/name/issues/42",
  "callbackUrl": "https://bugs.example.com/api/agent-status"
}
```

Post status changes to the callback with `X-Fixloop-Secret`:

```json
{
  "reportId": "24-character-public-id",
  "status": "pull_request",
  "detail": "Tests passed and PR opened",
  "pullRequestUrl": "https://github.com/owner/name/pull/43"
}
```

Allowed agent states are `assigned`, `fixing`, `pull_request`, `deployed`, `verified`, and `failed`.

The included `skills/fixloop-agent` skill gives a coding agent the claim, fix, test, PR, deploy, and verified-callback contract.

## Privacy and security defaults

- No name, email, user-agent, IP, or analytics identity is stored by the application.
- Page URLs lose query strings, fragments, usernames, and passwords at both client and server boundaries.
- Reports enter an IndexedDB outbox before network transmission and use a UUID idempotency key for safe retries.
- Attachments are type-checked, size-capped, hashed, and stored in Postgres.
- Status responses never expose report text or attachment bytes.
- Repository output from the classifier must exactly match the live GitHub catalog.
- GitHub issue creation includes an idempotency marker and scans existing issues before writing.
- Cron, GitHub webhook, and agent callback endpoints require separate secrets.
- Automatic agent execution is opt-in and belongs behind its own sandbox and approval policy.

Production deployments should also add edge rate limiting, malware scanning for documents, retention limits, encrypted object storage for larger files, and private status-page authentication when reports may contain sensitive product details.

## Test

```bash
npm install
npm run check
```

## License

MIT
