export function json(response, status, body) {
  response.status(status);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.send(JSON.stringify(body));
}

export function method(response, allowed) {
  response.setHeader("Allow", allowed.join(", "));
  return json(response, 405, { error: "Method not allowed" });
}
