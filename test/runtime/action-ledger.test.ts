import { utimes } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  cleanOldRuns,
  getSessionActions,
  listRuns,
  loadRun,
  recordAction,
  runFilePath,
} from "../../src/runtime/action-ledger.js";
import { withTempDir } from "../helpers.js";

describe("Action Ledger", () => {
  it("records actions, auto-increments sequence, and computes fingerprints", async () => {
    await withTempDir(async (home) => {
      const a1 = await recordAction(home, {
        sessionId: "session-abc",
        harness: "codex",
        tool: "search",
        normalizedArgs: { query: "auth bug" },
        inputFingerprint: "fp-1",
        status: "completed",
        outputSnippet: "found src/server/auth.ts",
      });

      expect(a1.sequence).toBe(1);
      expect(a1.timestamp).toBeDefined();

      const a2 = await recordAction(home, {
        sessionId: "session-abc",
        harness: "codex",
        tool: "read",
        normalizedArgs: { path: "src/server/auth.ts" },
        inputFingerprint: "fp-2",
        status: "completed",
      });

      expect(a2.sequence).toBe(2);

      const actions = await getSessionActions(home, "session-abc");
      expect(actions).toHaveLength(2);
      expect(actions[0]!.tool).toBe("search");
      expect(actions[1]!.tool).toBe("read");
    });
  });

  it("redacts synthetic secrets and bounds output snippets", async () => {
    await withTempDir(async (home) => {
      // Assemble synthetic secret at runtime
      const secret = ["ghp_", "ABCD1234wxyz5678"].join("");
      const snippet = `Database connection failed with token: ${secret}`;

      const action = await recordAction(home, {
        sessionId: "sec-session",
        harness: "codex",
        tool: "exec",
        normalizedArgs: { cmd: "npm test" },
        inputFingerprint: "fp-test",
        status: "failed",
        outputSnippet: snippet,
      });

      expect(action.outputSnippet).not.toContain(secret);
      expect(action.outputSnippet).toContain("[REDACTED");
    });
  });

  it("loads run summary with tool counts, loops, and verification status", async () => {
    await withTempDir(async (home) => {
      await recordAction(home, {
        sessionId: "run-stats",
        harness: "codex",
        tool: "search",
        normalizedArgs: { query: "oauth" },
        inputFingerprint: "fp-1",
        status: "completed",
        outputSnippet: "HIT src/server/auth.ts",
      });

      await recordAction(home, {
        sessionId: "run-stats",
        harness: "codex",
        tool: "search",
        normalizedArgs: { query: "oauth" },
        inputFingerprint: "fp-1",
        status: "completed",
        signals: { exactRepeat: true },
      });

      await recordAction(home, {
        sessionId: "run-stats",
        harness: "codex",
        tool: "test",
        normalizedArgs: { cmd: "npm test" },
        inputFingerprint: "fp-3",
        status: "completed",
      });

      const summary = await loadRun(home, "run-stats");
      expect(summary).not.toBeNull();
      expect(summary!.toolCalls).toBe(3);
      expect(summary!.repeatedActions).toBe(1);
      expect(summary!.loopsDetected).toBe(1);
      expect(summary!.memoryHits).toBe(1);
      expect(summary!.verified).toBe(true);
    });
  });

  it("lists stored runs and cleans expired runs past TTL", async () => {
    await withTempDir(async (home) => {
      await recordAction(home, {
        sessionId: "recent-run",
        harness: "codex",
        tool: "search",
        normalizedArgs: {},
        inputFingerprint: "fp-1",
        status: "completed",
      });

      await recordAction(home, {
        sessionId: "ancient-run",
        harness: "codex",
        tool: "search",
        normalizedArgs: {},
        inputFingerprint: "fp-2",
        status: "completed",
      });

      const runsBefore = await listRuns(home);
      expect(runsBefore).toContain("recent-run");
      expect(runsBefore).toContain("ancient-run");

      // Backdate ancient run file to 10 days ago
      const ancientPath = runFilePath(home, "ancient-run");
      const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
      await utimes(ancientPath, tenDaysAgo / 1000, tenDaysAgo / 1000);

      const deleted = await cleanOldRuns(home, 7);
      expect(deleted).toBe(1);

      const runsAfter = await listRuns(home);
      expect(runsAfter).toContain("recent-run");
      expect(runsAfter).not.toContain("ancient-run");
    });
  });
});
