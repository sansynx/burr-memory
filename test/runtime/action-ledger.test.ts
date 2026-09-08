import {
  readFile,
  utimes,
  mkdir,
  symlink,
  writeFile,
  rename,
} from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanOldRuns,
  clearSessionCache,
  getSessionActions,
  listRuns,
  loadRun,
  recordAction,
  runFilePath,
} from "../../src/runtime/action-ledger.js";
import { withTempDir } from "../helpers.js";

describe("Action Ledger", () => {
  it("assigns unique sequences in persisted order for concurrent actions", async () => {
    await withTempDir(async (home) => {
      const action = {
        sessionId: "concurrent-run",
        harness: "codex",
        tool: "exec",
        normalizedArgs: {},
        inputFingerprint: "fp",
        status: "completed" as const,
      };
      await recordAction(home, action);
      await Promise.all(
        Array.from({ length: 10 }, () => recordAction(home, action)),
      );
      const summary = await loadRun(home, action.sessionId);
      expect(summary?.actions.map((entry) => entry.sequence)).toEqual(
        Array.from({ length: 11 }, (_, index) => index + 1),
      );
    });
  });
  it("summarizes all actions beyond the runtime cache window", async () => {
    await withTempDir(async (home) => {
      const first = await recordAction(home, {
        sessionId: "long-run",
        harness: "codex",
        tool: "exec",
        normalizedArgs: {},
        inputFingerprint: "fp",
        status: "failed",
        timestamp: "2026-01-01T00:00:00Z",
      });
      const rows = Array.from({ length: 500 }, (_, index) => ({
        ...first,
        sequence: index + 1,
      }));
      await writeFile(
        runFilePath(home, "long-run"),
        rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
      );
      clearSessionCache();
      await recordAction(home, {
        ...first,
        sequence: 501,
        status: "completed",
        timestamp: "2026-01-01T00:01:00Z",
      });
      const summary = await loadRun(home, "long-run");
      expect(summary?.toolCalls).toBe(501);
      expect(summary?.failedCalls).toBe(500);
      expect(summary?.durationMs).toBe(60000);
    });
  });

  it("does not cache an action when its write fails", async () => {
    await withTempDir(async (home) => {
      const action = {
        sessionId: "failed-write",
        harness: "codex",
        tool: "exec",
        normalizedArgs: {},
        inputFingerprint: "fp",
        status: "completed" as const,
      };
      await recordAction(home, action);
      const path = runFilePath(home, action.sessionId);
      await rename(path, `${path}.backup`);
      await mkdir(path);
      await expect(recordAction(home, action)).rejects.toThrow();
      expect(await getSessionActions(home, action.sessionId)).toHaveLength(1);
    });
  });
  it("isolates identical session ids in different homes", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (otherHome) => {
        await recordAction(home, {
          sessionId: "shared-id",
          harness: "codex",
          tool: "search",
          normalizedArgs: {},
          inputFingerprint: "fp",
          status: "completed",
        });
        expect(await getSessionActions(otherHome, "shared-id")).toEqual([]);
      });
    });
  });
  it("redacts nested arguments and errors before caching and persistence", async () => {
    await withTempDir(async (home) => {
      const secret = ["synthetic", "credential", "value"].join("-");
      const action = await recordAction(home, {
        sessionId: "private-args",
        harness: "codex",
        tool: "exec",
        normalizedArgs: {
          token: secret,
          nested: [{ password: secret }],
          cmd: `token=${secret}`,
        },
        error: `password=${secret}`,
        inputFingerprint: "fp",
        status: "failed",
      });
      expect(JSON.stringify(action)).not.toContain(secret);
      expect(
        await readFile(runFilePath(home, "private-args"), "utf8"),
      ).not.toContain(secret);
    });
  });

  it("does not prune through a symlinked runs directory", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (outside) => {
        await mkdir(join(home, ".burr", "memory"), { recursive: true });
        await symlink(outside, join(home, ".burr", "runs"), "junction");
        const victim = join(outside, "old.jsonl");
        await writeFile(victim, "keep");
        await utimes(victim, 0, 0);
        await cleanOldRuns(home);
        expect(await readFile(victim, "utf8")).toBe("keep");
      });
    });
  });
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
