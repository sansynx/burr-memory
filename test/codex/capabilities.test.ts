import { describe, expect, it } from "vitest";
import { getHarnessCapabilities } from "../../src/codex/capabilities.js";

describe("host capabilities", () => {
  it("reports Windsurf rule guidance without automatic tool interception", () => {
    expect(getHarnessCapabilities(" Windsurf ")).toEqual({
      name: "Windsurf",
      beforeToolObservation: false,
      afterToolObservation: false,
      blocking: false,
      contextInjection: true,
    });
  });
});
