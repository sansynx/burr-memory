import { describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import * as dashboard from "../../src/cli/dashboard.js";

describe("dashboard CLI options", () => {
  it("passes the requested port to the listener", async () => {
    const run = vi.spyOn(dashboard, "runDashboard").mockResolvedValue(0);
    try {
      expect(await main(["dashboard", "--port", "49123"])).toBe(0);
      expect(run).toHaveBeenCalledWith({ port: 49123 });
    } finally {
      run.mockRestore();
    }
  });
  it.each([[], ["abc"], ["12x"], ["-1"], ["65536"]])(
    "rejects invalid port %j",
    async (...values) => {
      const run = vi.spyOn(dashboard, "runDashboard").mockResolvedValue(0);
      try {
        expect(await main(["dashboard", "--port", ...values])).toBe(1);
        expect(run).not.toHaveBeenCalled();
      } finally {
        run.mockRestore();
      }
    },
  );
});
