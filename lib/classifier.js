const DEFAULT_MODEL = "gpt-4.1-mini";

function fallback(report, repositories) {
  const requested = repositories.find(
    (repo) => repo.fullName.toLowerCase() === String(report.requested_repository ?? "").toLowerCase()
  );
  return requested
    ? {
        repository: requested.fullName,
        title: report.description.split(/[.!?\n]/)[0].slice(0, 120) || "Bug report",
        description: report.description,
        severity: "normal"
      }
    : null;
}

export async function classifyReport(report, attachments, repositories) {
  if (!process.env.OPENAI_API_KEY) return fallback(report, repositories);

  const catalog = repositories
    .map((repo) => `- ${repo.fullName}: ${repo.description || "No description"}`)
    .join("\n");
  const content = [
    {
      type: "input_text",
      text: [
        "Route this software bug to exactly one repository from the catalog.",
        "Return JSON with repository, title, description, and severity.",
        "If there is not enough evidence, set repository to null.",
        `Page: ${report.page_title}`,
        `URL: ${report.page_url}`,
        `Requested repository: ${report.requested_repository || "none"}`,
        `Report: ${report.description}`,
        `Catalog:\n${catalog}`
      ].join("\n\n")
    },
    ...attachments
      .filter((attachment) => attachment.mime_type.startsWith("image/"))
      .slice(0, 3)
      .map((attachment) => ({
        type: "input_image",
        image_url: `data:${attachment.mime_type};base64,${attachment.content.toString("base64")}`
      }))
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "fixloop_route",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["repository", "title", "description", "severity"],
            properties: {
              repository: { type: ["string", "null"] },
              title: { type: "string" },
              description: { type: "string" },
              severity: { type: "string", enum: ["low", "normal", "high", "critical"] }
            }
          }
        }
      }
    })
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const data = await response.json();
  const parsed = JSON.parse(data.output_text);
  const match = repositories.find(
    (repo) => repo.fullName.toLowerCase() === String(parsed.repository ?? "").toLowerCase()
  );
  if (!match) return null;
  return {
    repository: match.fullName,
    title: String(parsed.title).slice(0, 180),
    description: String(parsed.description).slice(0, 8000),
    severity: parsed.severity
  };
}
