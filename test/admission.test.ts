import { describe, expect, it } from "vitest";
import { admitResolution, admitSignal } from "../src/shared/admission.js";

describe("admitSignal", () => {
  it("discards a port already in use", () => {
    const result = admitSignal({
      error: "Error: listen EADDRINUSE: address already in use :::3000",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("port-in-use");
  });

  it("discards a down local dev server", () => {
    const result = admitSignal({
      error: "request to http://127.0.0.1:5173 failed: connect ECONNREFUSED",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dev-server-down");
  });

  it("discards a missing local asset", () => {
    const result = admitSignal({
      error: "ENOENT: no such file or directory, open 'public/logo.png'",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-local-asset");
  });

  it("discards an unset local env var", () => {
    const result = admitSignal({
      error: "environment variable DATABASE_URL is not set",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unset-local-env");
  });

  it("discards a flaky one-off network blip", () => {
    const result = admitSignal({
      error: "getaddrinfo EAI_AGAIN api.example.com",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("flaky-network");
  });

  it("keeps a reusable TypeError even if a port mention appears", () => {
    const result = admitSignal({
      error:
        "TypeError: Cannot read properties of undefined (reading 'id') while server said port 3000 in use",
      rootCause: "API response shape changed; callers still read user.id",
    });
    expect(result.ok).toBe(true);
  });

  it("keeps a library misuse / wrong config pattern", () => {
    const result = admitSignal({
      error:
        "ZodError: Required at email — schema validation failed for the login payload",
    });
    expect(result.ok).toBe(true);
  });
});

describe("admitResolution", () => {
  it.each([
    "npm test failed with 2 failures",
    "npm test",
    "0 passed, 3 failed",
    "14 passed, 1 failed",
    "tests did not pass",
    "benchmark will run later",
    "exit code 01",
  ])("rejects unsuccessful or missing outcomes: %s", (verification) => {
    expect(
      admitResolution({
        error: "TypeError: synthetic",
        rootCause: "missing guard",
        fix: "add guard",
        verification,
      }).ok,
    ).toBe(false);
  });
  it("refuses 'I think it's fixed' without evidence", () => {
    const result = admitResolution({
      error: "TypeError: x is undefined",
      rootCause: "missing null check",
      fix: "guard the access",
      verification: "I think it's fixed",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-verification");
  });

  it("keeps a resolution with a real test run", () => {
    const result = admitResolution({
      error: "TypeError: x is undefined",
      rootCause: "missing null check",
      fix: "guard the access",
      verification: "npm test — 14 passed, 0 failing",
    });
    expect(result.ok).toBe(true);
  });

  it("keeps reproduced-and-gone verification", () => {
    const result = admitResolution({
      error: "Hydration mismatch on the settings page",
      rootCause: "server rendered ISO date, client used local timezone",
      fix: "format dates in UTC on both sides",
      verification:
        "reproduced the mismatch, then it was gone after the UTC change",
    });
    expect(result.ok).toBe(true);
  });
});
