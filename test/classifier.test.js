import test from "node:test";
import assert from "node:assert/strict";
import { classifyReport } from "../lib/classifier.js";

const report = {
  requested_repository: "Acme/Storefront",
  description: "Checkout button does nothing. Expected an order.",
  page_title: "Checkout",
  page_url: "https://example.test/checkout"
};

test("classifier uses an exact catalog match without OpenAI", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await classifyReport(report, [], [
      { fullName: "acme/storefront", description: "Web storefront" }
    ]);
    assert.equal(result.repository, "acme/storefront");
    assert.equal(result.severity, "normal");
  } finally {
    if (previous) process.env.OPENAI_API_KEY = previous;
  }
});

test("classifier fails closed when requested repository is outside catalog", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.equal(
      await classifyReport(report, [], [{ fullName: "acme/api", description: "" }]),
      null
    );
  } finally {
    if (previous) process.env.OPENAI_API_KEY = previous;
  }
});
