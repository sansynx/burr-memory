import { describe, expect, it } from "vitest";
import { admitResolution, admitSignal } from "../../src/shared/admission.js";

describe("admission edges", () => {
  it("discards a missing local jpeg even with a noisy prefix", () => {
    const result = admitSignal({
      error: "Build failed\nENOENT: no such file or directory, open 'assets/hero.JPEG'",
    });
    expect(result).toEqual({ ok: false, reason: "missing-local-asset" });
  });

  it("keeps cannot find module for a published package name", () => {
    const result = admitSignal({
      error: "Error: Cannot find module 'zod'",
    });
    expect(result.ok).toBe(true);
  });

  it("refuses empty verification", () => {
    expect(
      admitResolution({
        error: "TypeError: x",
        rootCause: "null",
        fix: "guard",
        verification: "   ",
      }).ok,
    ).toBe(false);
  });

  it("refuses 'should work now' as verification", () => {
    expect(
      admitResolution({
        error: "TypeError: x",
        rootCause: "null",
        fix: "guard",
        verification: "should work now",
      }).reason,
    ).toBe("missing-verification");
  });

  it("keeps a measured check as verification", () => {
    expect(
      admitResolution({
        error: "slow query on users",
        rootCause: "missing index",
        fix: "add index on email",
        verification: "measured p95 1200ms before / 40ms after",
      }).ok,
    ).toBe(true);
  });
});
