# Fixloop

Fixloop is a portable bug-to-fix loop for any web application:

1. A floating in-product widget captures the page context, description, clipboard screenshots, images, PDFs, and documents.
2. An IndexedDB outbox retries until the durable intake API confirms storage.
3. A scheduled processor routes the report only to a repository from a live GitHub allowlist.
4. GitHub receives an idempotent issue.
5. An optional signed agent webhook starts the fix and re-pings unfinished work every twelve hours.
6. Agent and GitHub callbacks build a public status timeline through verification.

The `/status` page lists reports submitted from the current browser. A tracking ID can be added manually when a report was submitted elsewhere. Set `FIXLOOP_PUBLIC_BASE_URL` to the Fixloop service origin so widgets embedded on other sites receive an absolute status link. The browser-local list does not transfer between origins or browser profiles. Operators can page through the server-owned report list with `FIXLOOP_STATUS_SECRET`. The public path fetches only unguessable report IDs already known to the browser and sends batches in a POST body, never in URL logs or history. Operators can skip reports that have not entered active processing and must record a reason. The row and its timeline remain as an audit record. Status responses retain the newest 100 timeline events per report.

Reporter identity is optional and caller-supplied. Fixloop never derives it from network or browser metadata. Query strings, URL fragments, credentials, and browser fingerprints are excluded by default.

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
    senderIdentity: "user:stable-internal-id",
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
4. For an existing database, apply `sql/002_status_management.sql` and `sql/003_sender_identity.sql`.
5. Deploy the repository to Vercel.
6. Add a GitHub webhook pointing to `https://YOUR_DOMAIN/api/github-webhook`.
7. Select the `Issues` event and use `FIXLOOP_GITHUB_WEBHOOK_SECRET`.
8. Call `GET /api/process` with `Authorization: Bearer CRON_SECRET` for a smoke test.

Set `FIXLOOP_STATUS_SECRET` to a separate long random value for the authenticated operator list.

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
  "deliveryId": "idempotency-key-for-this-delivery",
  "delivery": "initial",
  "senderIdentity": "user:stable-internal-id",
  "senderIdentitySource": "caller",
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

- Reporter identity is stored only when the embedding application supplies `senderIdentity`. It is labeled caller-supplied, not authentication proof. Fixloop does not derive names, email, user-agent, IP, or analytics identity.
- Page URLs lose query strings, fragments, usernames, and passwords at both client and server boundaries.
- Reports enter an IndexedDB outbox before network transmission and use a UUID idempotency key for safe retries.
- Attachments are type-checked, size-capped, hashed, and stored in Postgres.
- Status responses never expose report text or attachment bytes.
- Repository output from the classifier must exactly match the live GitHub catalog.
- GitHub issue creation includes an idempotency marker and scans existing issues before writing.
- Cron, GitHub webhook, and agent callback endpoints require separate secrets.
- Automatic agent execution is opt-in and belongs behind its own sandbox and approval policy.

The included Vercel transport accepts up to 2 MB per file and 2.5 MB of raw attachments per report so the base64 request remains below the platform body limit.

Production deployments should also add edge rate limiting, malware scanning for documents, retention limits, direct-to-object-storage uploads for larger files, and private status-page authentication when reports may contain sensitive product details.

## Test

```bash
npm install
npm run check
```

## License

MIT
