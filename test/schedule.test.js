import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("report processor runs every five minutes", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

  assert.deepEqual(config.crons, [
    {
      path: "/api/process",
      schedule: "*/5 * * * *"
    }
  ]);
});
