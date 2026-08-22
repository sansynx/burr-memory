import { describe, expect, it } from "vitest";
import { renderPlaybook, renderSignal, signature } from "../src/shared/playbook.js";

describe("signature", () => {
  it("builds a stable slug from a redacted error", () => {
    const a = signature("TypeError: Cannot read properties of undefined (reading 'id')");
    const b = signature("TypeError: Cannot read properties of undefined (reading 'id')");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(a.length).toBeLessThanOrEqual(80);
  });

  it("reserves the hash suffix for long signatures", () => {
    const prefix = [
      "abcdefghijklmnopqrst",
      "bcdefghijklmnopqrstu",
      "cdefghijklmnopqrstuv",
      "defghijklmnopqrstuvw",
      "efghijklmnopqrstuvwx",
      "fghijklmnopqrstuvwxy",
    ].join(" ");
    const longError = `${prefix}${" repeated".repeat(2_000)}`;
    const first = signature(`${longError}\nfirst root cause`);
    const second = signature(`${longError}\nsecond root cause`);

    expect(first).not.toBe(second);
    expect(first).toMatch(/-[a-f0-9]{8}$/);
    expect(second).toMatch(/-[a-f0-9]{8}$/);
    expect(first.length).toBeLessThanOrEqual(80);
  });
});

describe("renderPlaybook", () => {
  it("includes the required sections", () => {
    const markdown = renderPlaybook({
      title: "Hydration mismatch",
      signature: "hydration-mismatch",
      error: "Text content did not match",
      rootCause: "timezone drift",
      fix: "UTC on both sides",
      failedAttempts: ["cleared cache"],
      verification: "npm test — 3 passed",
      context: { language: "TypeScript", framework: "Next.js", risk: "low", confidence: "high" },
    });
    for (const heading of ["## Error", "## Root Cause", "## Fix", "## Failed Attempts", "## Verification", "## Context"]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain("timezone drift");
  });
});

describe("renderSignal", () => {
  it("includes title, error, signature, and why it was kept", () => {
    const markdown = renderSignal({
      title: "Zod login payload",
      signature: "zod-login",
      error: "ZodError: Required at email",
      stack: "at parse (zod.js:1)",
      command: "npm test",
      exitCode: 1,
      attemptedFixes: ["loosened the schema"],
      whyKeep: "Wrong client payload shape will recur",
    });
    expect(markdown).toContain("zod-login");
    expect(markdown).toContain("ZodError");
    expect(markdown).toContain("Wrong client payload shape will recur");
  });
});
