const API = "https://api.github.com";

function headers() {
  const token = process.env.FIXLOOP_GITHUB_TOKEN;
  if (!token) throw new Error("FIXLOOP_GITHUB_TOKEN is required");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "fixloop",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function github(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...headers(), ...options.headers } });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`GitHub ${response.status}: ${detail}`);
  }
  return response.status === 204 ? null : response.json();
}

export async function repositoryCatalog() {
  const org = process.env.FIXLOOP_GITHUB_ORG;
  if (!org) throw new Error("FIXLOOP_GITHUB_ORG is required");
  const configured = String(process.env.FIXLOOP_REPOSITORIES ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const allowlist = configured.length ? new Set(configured) : null;
  const repositories = [];

  for (let page = 1; page <= 10; page += 1) {
    const batch = await github(`/orgs/${encodeURIComponent(org)}/repos?per_page=100&page=${page}&type=all`);
    for (const repo of batch) {
      if (repo.archived || repo.disabled || !repo.has_issues) continue;
      if (allowlist && !allowlist.has(repo.full_name.toLowerCase())) continue;
      repositories.push({
        fullName: repo.full_name,
        description: repo.description || ""
      });
    }
    if (batch.length < 100) break;
  }
  if (!repositories.length) throw new Error("No issue-enabled repositories are available");
  return repositories;
}

export async function findIssueByMarker(repository, marker) {
  const [owner, name] = repository.split("/");
  for (let page = 1; page <= 10; page += 1) {
    const issues = await github(`/repos/${owner}/${name}/issues?state=all&per_page=100&page=${page}`);
    const match = issues.find((issue) => !issue.pull_request && String(issue.body ?? "").includes(marker));
    if (match) return match;
    if (issues.length < 100) break;
  }
  return null;
}

export async function createIssue(repository, { title, body, labels = [] }) {
  const [owner, name] = repository.split("/");
  return github(`/repos/${owner}/${name}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body, labels })
  });
}
