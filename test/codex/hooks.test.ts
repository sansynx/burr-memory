import { describe, expect, it } from "vitest";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  handlePostToolUse,
  handlePreCompact,
  handlePreToolUse,
  handleSessionEnd,
  handleSessionStart,
} from "../../src/codex/hooks.js";
import {
  listAllMemories,
  promoteCandidate,
} from "../../src/learning/consolidator.js";
import { getSessionActions } from "../../src/runtime/action-ledger.js";
import {
  loadAllEvents,
  recordMetricsEvent,
} from "../../src/metrics/tracker.js";
import { withTempDir } from "../helpers.js";

describe("OpenAI Codex Runtime Hooks", () => {
  it("uses the session-start input root to load disabled mode", async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (home) => {
        await mkdir(join(root, ".burr"));
        await writeFile(
          join(root, ".burr", "config.json"),
          JSON.stringify({ mode: "off" }),
        );
        await handleSessionStart({ sessionId: "input-root", root }, { home });
        expect(await readdir(home)).toEqual([]);
      });
    });
  });
  it("redacts structured metric data before persistence", async () => {
    await withTempDir(async (home) => {
      const secret = ["synthetic", "metric", "credential"].join("-");
      await recordMetricsEvent(
        {
          type: "session_start",
          data: { token: secret, command: `password=${secret}` },
        },
        home,
      );
      expect(JSON.stringify(await loadAllEvents(home))).not.toContain(secret);
    });
  });

  it("does not record tool actions when the runtime is disabled", async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (home) => {
        await mkdir(join(root, ".burr"));
        await writeFile(
          join(root, ".burr", "config.json"),
          JSON.stringify({ runtime: { enabled: false } }),
        );
        await handlePostToolUse(
          {
            sessionId: "runtime-disabled",
            tool: "exec",
            args: {},
            output: "done",
          },
          { home, root },
        );
        expect(await readdir(home)).toEqual([]);
      });
    });
  });
  it("does not write runtime or learned state when mode is off", async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (home) => {
        await mkdir(join(root, ".burr"));
        await writeFile(
          join(root, ".burr", "config.json"),
          JSON.stringify({ mode: "off" }),
        );
        const sessionId = "disabled-session";
        await handleSessionStart({ sessionId }, { home, root });
        await handlePostToolUse(
          { sessionId, tool: "exec", args: {}, output: "done" },
          { home, root },
        );
        const result = await handleSessionEnd(
          {
            sessionId,
            verified: true,
            error: "failure",
            rootCause: "cause",
            fix: "correct configuration",
          },
          { home, root },
        );
        expect(result.candidatesGenerated).toBe(0);
        expect(await readdir(home)).toEqual([]);
      });
    });
  });
  it("PreToolUse allows safe action, warns on repeated risk, and blocks on high-confidence cycle", async () => {
    await withTempDir(async (home) => {
      const sessionId = "codex-test-session";

      // 1. First search -> safe
      const r1 = await handlePreToolUse(
        { sessionId, tool: "search", args: { query: "prisma client bug" } },
        { home },
      );
      expect(r1.allow).toBe(true);
      expect(r1.block).toBeFalsy();

      await handlePostToolUse(
        {
          sessionId,
          tool: "search",
          args: { query: "prisma client bug" },
          output: "search failed",
          error: "search failed",
        },
        { home },
      );

      // 2. Exact repeat -> score 40 -> record
      const r2 = await handlePreToolUse(
        { sessionId, tool: "search", args: { query: "prisma client bug" } },
        { home },
      );
      expect(r2.allow).toBe(true);

      await handlePostToolUse(
        {
          sessionId,
          tool: "search",
          args: { query: "prisma client bug" },
          output: "search failed",
          error: "search failed",
        },
        { home },
      );

      // 3. Repeat a sequence to form a cycle (search -> read -> search -> read -> search)
      await handlePostToolUse(
        {
          sessionId,
          tool: "read",
          args: { file: "schema.prisma" },
          output: "model User",
        },
        { home },
      );
      await handlePostToolUse(
        {
          sessionId,
          tool: "search",
          args: { query: "prisma client bug" },
          output: "search failed",
          error: "search failed",
        },
        { home },
      );
      await handlePostToolUse(
        {
          sessionId,
          tool: "read",
          args: { file: "schema.prisma" },
          output: "model User",
        },
        { home },
      );

      // Now search again -> exact repeat (40) + cycle (30) = 70 -> BLOCK!
      const rBlocked = await handlePreToolUse(
        { sessionId, tool: "search", args: { query: "prisma client bug" } },
        { home },
      );
      expect(rBlocked.allow).toBe(false);
      expect(rBlocked.block).toBe(true);
      expect(rBlocked.score).toBeGreaterThanOrEqual(70);
      expect(rBlocked.reasons).toContain("exact-repeat");
      expect(rBlocked.reasons).toContain("cycle");
      expect(rBlocked.message).toContain("Burr Loop Guard");

      // Verify blocked action was recorded in ledger
      const actions = await getSessionActions(home, sessionId);
      const lastAction = actions[actions.length - 1];
      expect(lastAction?.status).toBe("blocked");
    });
  });

  it("SessionStart retrieves top memories and injects guidance prompt", async () => {
    await withTempDir(async (home) => {
      await promoteCandidate(
        {
          id: "cand-codex-1",
          type: "repository-rule",
          statement: "GitHub issue parsing requires pagination token check.",
          scope: { level: "repository", repository: "sansynx/burr-memory" },
          evidence: { sessionId: "prev-s", observedCount: 3, verified: true },
          confidence: 0.92,
          createdAt: new Date().toISOString(),
          status: "candidate",
        },
        home,
      );

      const res = await handleSessionStart(
        {
          sessionId: "codex-session-new",
          taskDescription: "Fix GitHub issue parsing pagination",
          scope: { level: "repository", repository: "sansynx/burr-memory" },
        },
        { home },
      );

      expect(res.retrievedMemories).toHaveLength(1);
      expect(res.injectedPrompt).toContain("burr:active-memory");
      expect(res.injectedPrompt).toContain("pagination token check");
    });
  });

  it("SessionEnd reflects on verified run and promotes candidate to persistent memory", async () => {
    await withTempDir(async (home) => {
      const sessionId = "codex-session-end";

      await handlePostToolUse(
        {
          sessionId,
          tool: "search",
          args: { q: "auth error" },
          output: "found auth.ts",
        },
        { home },
      );
      await handlePostToolUse(
        {
          sessionId,
          tool: "edit",
          args: { path: "src/server/auth.ts" },
          output: "saved",
        },
        { home },
      );
      await handlePostToolUse(
        {
          sessionId,
          tool: "bash",
          args: { cmd: "npm test" },
          output: "1 passed",
        },
        { home },
      );

      const endRes = await handleSessionEnd(
        {
          sessionId,
          verified: true,
          verificationCommand: "npm test",
          taskDescription: "Fix auth error in src/server/auth.ts",
          scope: { level: "repository", repository: "sansynx/burr-memory" },
        },
        { home },
      );

      expect(endRes.verified).toBe(true);
      expect(endRes.candidatesGenerated).toBeGreaterThan(0);
      expect(endRes.memoriesPromoted).toBeGreaterThan(0);

      const all = await listAllMemories(home);
      expect(all.length).toBeGreaterThan(0);
    });
  });

  it("PreCompact preserves active notes", () => {
    const compact = handlePreCompact({});
    expect(compact.preservedNotes).toContain("Burr runtime guard");
  });
});
