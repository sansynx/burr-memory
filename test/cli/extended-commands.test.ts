import { describe, expect, it } from "vitest";
import { runCompare } from "../../src/cli/compare.js";
import { runDoctor } from "../../src/cli/doctor.js";
import { runMemoryCmd } from "../../src/cli/memory-cmd.js";
import { runStats } from "../../src/cli/stats.js";
import { promoteCandidate } from "../../src/learning/consolidator.js";
import { recordAction } from "../../src/runtime/action-ledger.js";
import { withTempDir } from "../helpers.js";

describe("CLI Extended Commands", () => {
  it("burr stats executes cleanly and returns 0", async () => {
    await withTempDir(async (home) => {
      const code = await runStats({ home });
      expect(code).toBe(0);
    });
  });

  it("burr compare compares two valid runs", async () => {
    await withTempDir(async (home) => {
      await recordAction(home, {
        sessionId: "run-1",
        harness: "codex",
        tool: "search",
        normalizedArgs: {},
        inputFingerprint: "fp-1",
        status: "completed",
      });

      await recordAction(home, {
        sessionId: "run-2",
        harness: "codex",
        tool: "search",
        normalizedArgs: {},
        inputFingerprint: "fp-1",
        status: "completed",
      });

      const code = await runCompare(["run-1", "run-2"], { home });
      expect(code).toBe(0);
    });
  });

  it("burr memory summary, list, and inspect", async () => {
    await withTempDir(async (home) => {
      const mem = await promoteCandidate(
        {
          id: "cand-cli-test",
          type: "knowledge",
          statement: "Prisma client requires generate step.",
          scope: { level: "global" },
          evidence: { sessionId: "s1", observedCount: 2, verified: true },
          confidence: 0.9,
          createdAt: new Date().toISOString(),
          status: "candidate",
        },
        home,
      );

      const codeSummary = await runMemoryCmd(["summary"], { home });
      expect(codeSummary).toBe(0);

      const codeList = await runMemoryCmd(["list"], { home });
      expect(codeList).toBe(0);

      const codeInspect = await runMemoryCmd(["inspect", mem.id], { home });
      expect(codeInspect).toBe(0);

      const codePrune = await runMemoryCmd(["prune"], { home });
      expect(codePrune).toBe(0);
    });
  });

  it("burr doctor reports health and returns 0", async () => {
    await withTempDir(async (home) => {
      const code = await runDoctor({ home });
      expect(code).toBe(0);
    });
  });
});
