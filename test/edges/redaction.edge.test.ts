import { describe, expect, it } from "vitest";
import { redact } from "../../src/shared/redaction.js";

describe("redaction edges", () => {
  it("returns an empty string for empty input", () => {
    expect(redact("")).toBe("");
  });

  it("redacts every JWT in a multi-secret dump", () => {
    const first =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const second =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyIn0.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const text = redact(`pair ${first} ${second}`);
    expect(text).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(text.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("redacts .env-style SECRET_KEY and AWS secret assignments", () => {
    const dump = [
      "DATABASE_URL=postgres://app:supersecret@db/app",
      "SECRET_KEY=not-for-disk",
      "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG",
    ].join("\n");
    const text = redact(dump);
    expect(text).not.toContain("supersecret");
    expect(text).not.toContain("not-for-disk");
    expect(text).not.toContain("wJalrXUtnFEMI/K7MDENG");
  });

  it("redacts a GitHub token and a Slack token together", () => {
    const text = redact("gho_abcdefghijklmnopqrstuvwx1234567890 and xoxb-1234567890-abcdefghij");
    expect(text).not.toContain("gho_abcdefghijklmnopqrstuvwx1234567890");
    expect(text).not.toContain("xoxb-1234567890-abcdefghij");
  });

  it("does not treat a public 8.8.8.8 address as an internal IP", () => {
    expect(redact("resolver 8.8.8.8")).toContain("8.8.8.8");
  });

  it("clips a pasted source dump to 12k", () => {
    expect(redact(`line\n`.repeat(20_000)).length).toBe(12_000);
  });
});
