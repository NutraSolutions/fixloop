export const MAX_STATUS_REPORTS = 50;

export function parseReportIds(value) {
  const parts = (Array.isArray(value) ? value : [value])
    .flatMap((part) => String(part ?? "").split(","))
    .map((part) => part.trim())
    .filter(Boolean);
  const ids = [...new Set(parts)];
  if (!ids.length) throw new Error("At least one report id is required");
  if (ids.length > MAX_STATUS_REPORTS) {
    throw new Error(`At most ${MAX_STATUS_REPORTS} report ids are allowed`);
  }
  if (ids.some((id) => !/^[a-f0-9]{24}$/.test(id))) {
    throw new Error("Invalid report id");
  }
  return ids;
}
