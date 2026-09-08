import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dispatchCodexHook } from "../../src/codex/adapter.js";
import { mergeCodexHooks } from "../../src/shared/codex.js";
import { getSessionActions } from "../../src/runtime/action-ledger.js";
import { withTempDir } from "../helpers.js";
import { runGlobal } from "../../src/cli/global.js";
import { promoteCandidate } from "../../src/learning/consolidator.js";

describe("native Codex hook adapter", () => {
  it("honors project off mode when Codex starts in a subdirectory", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, ".burr"));
      await mkdir(join(root, "child"));
      await writeFile(join(root, ".burr", "config.json"), '{"mode":"off"}');
      expect(
        await dispatchCodexHook(
          {
            session_id: "nested-off",
            cwd: join(root, "child"),
            hook_event_name: "SessionStart",
          },
          { home: root },
        ),
      ).toEqual({});
      expect(
        await readFile(join(root, ".burr", "metrics", "events.jsonl")).catch(
          () => null,
        ),
      ).toBeNull();
    });
  });
  it("registers in a custom Codex home", async () => {
    await withTempDir(async (root) => {
      await runGlobal({ home: root, codexHome: join(root, "custom-codex") });
      expect(
        JSON.parse(
          await readFile(join(root, "custom-codex", "hooks.json"), "utf8"),
        ).hooks.PreToolUse,
      ).toHaveLength(1);
      expect(
        await readFile(join(root, ".codex", "hooks.json")).catch(() => null),
      ).toBeNull();
    });
  });
  it("injects repository memory into a native session", async () => {
    await withTempDir(async (root) => {
      const repository = root.split(/[\\/]/).at(-1)!;
      await promoteCandidate(
        {
          id: "scope-test",
          type: "repository-rule",
          statement: "Use the synthetic targeted check for this repository.",
          scope: { level: "repository", repository },
          evidence: { sessionId: "seed", observedCount: 2, verified: true },
          confidence: 0.9,
          createdAt: new Date().toISOString(),
          status: "candidate",
        },
        root,
      );
      const result = await dispatchCodexHook(
        { session_id: "scoped", cwd: root, hook_event_name: "SessionStart" },
        { home: root },
      );
      expect(JSON.stringify(result)).toContain("synthetic targeted check");
    });
  });
  it("records one result when project and global hooks both deliver it", async () => {
    await withTempDir(async (root) => {
      const event = {
        session_id: "duplicate",
        cwd: root,
        hook_event_name: "PostToolUse",
        tool_use_id: "call-1",
        tool_name: "Bash",
        tool_input: { command: "echo synthetic" },
        tool_response: { exit_code: 0, output: "synthetic" },
      };
      await Promise.all([
        dispatchCodexHook(event, { home: root }),
        dispatchCodexHook(event, { home: root }),
      ]);
      expect(await getSessionActions(root, "duplicate")).toHaveLength(1);
    });
  });
  it("returns a native deny decision and records failed Bash results", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, ".burr"));
      await writeFile(
        join(root, ".burr", "config.json"),
        JSON.stringify({ runtime: { blockScore: 0 } }),
      );
      const event = {
        session_id: "native",
        cwd: root,
        tool_name: "Bash",
        tool_input: { command: "synthetic-test" },
      };
      const result = await dispatchCodexHook(
        { ...event, hook_event_name: "PreToolUse" },
        { home: root },
      );
      expect(result).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      });
      await dispatchCodexHook(
        {
          ...event,
          hook_event_name: "PostToolUse",
          tool_response: { exit_code: 1, output: "synthetic failure" },
        },
        { home: root },
      );
      expect((await getSessionActions(root, "native")).at(-1)?.status).toBe(
        "failed",
      );
    });
  });

  it("validates native input and stays silent in off mode", async () => {
    await expect(
      dispatchCodexHook({ hook_event_name: "PreToolUse" }),
    ).rejects.toThrow();
    await withTempDir(async (root) => {
      await mkdir(join(root, ".burr"));
      await writeFile(join(root, ".burr", "config.json"), '{"mode":"off"}');
      expect(
        await dispatchCodexHook(
          { session_id: "off", cwd: root, hook_event_name: "SessionStart" },
          { home: root },
        ),
      ).toEqual({});
      expect(
        await readFile(join(root, ".burr", "runs", "off.jsonl")).catch(
          () => null,
        ),
      ).toBeNull();
    });
  });

  it("merges registrations idempotently and preserves other hooks", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, ".codex"));
      const path = join(root, ".codex", "hooks.json");
      const existing = {
        description: "User hooks",
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "custom-command" }] }],
        },
      };
      await writeFile(path, JSON.stringify(existing));
      expect(
        await mergeCodexHooks(root, ".codex/hooks.json", "node burr-hook"),
      ).toBe("created");
      const first = await readFile(path, "utf8");
      expect(JSON.parse(first).hooks.Stop).toEqual(existing.hooks.Stop);
      expect(JSON.parse(first).hooks.PreToolUse).toHaveLength(1);
      expect(
        await mergeCodexHooks(root, ".codex/hooks.json", "node burr-hook"),
      ).toBe("skipped");
      expect(await readFile(path, "utf8")).toBe(first);
    });
  });
});
