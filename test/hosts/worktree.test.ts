import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/cli/init.js";
import {
  handleSessionStart,
  handlePreToolUse,
  handlePostToolUse,
  handleSessionEnd,
} from "../../src/codex/hooks.js";
import { SKILL_NAMES } from "../helpers.js";

describe("Git Worktree Memory & Multi-Session Agent Isolation", () => {
  let homeDir: string;
  let mainRepoDir: string;
  let worktreeADir: string;
  let worktreeBDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "burr-wt-home-"));
    mainRepoDir = await mkdtemp(join(tmpdir(), "burr-wt-repo-"));
    worktreeADir = await mkdtemp(join(tmpdir(), "burr-wt-worktree-a-"));
    worktreeBDir = await mkdtemp(join(tmpdir(), "burr-wt-worktree-b-"));
  });

  afterEach(async () => {
    const opts = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 };
    await rm(homeDir, opts);
    await rm(mainRepoDir, opts);
    await rm(worktreeADir, opts);
    await rm(worktreeBDir, opts);
  });

  it("exposes all Burr skills in .agents/skills/ matching standard agent skill discovery structure", async () => {
    await runInit(mainRepoDir);

    for (const name of SKILL_NAMES) {
      const skillPath = join(mainRepoDir, ".agents", "skills", name, "SKILL.md");
      const content = await readFile(skillPath, "utf8");
      expect(content).toContain(`name: ${name}`);
      expect(content).toContain("description:");
    }
  });

  it("shares learned memory across isolated git worktrees", async () => {
    await runInit(worktreeADir);
    await runInit(worktreeBDir);

    const repoSlug = "sansynx/burr-memory";

    const sessionAId = "agent-worktree-a-task-1";
    const startA = await handleSessionStart(
      {
        sessionId: sessionAId,
        taskDescription: "Fix missing dist exports on TypeScript build",
        scope: { repo: repoSlug },
        root: worktreeADir,
      },
      { home: homeDir, root: worktreeADir }
    );
    expect(startA.retrievedMemories).toHaveLength(0);

    await handlePreToolUse(
      { sessionId: sessionAId, tool: "run_command", args: { cmd: "npm run build" } },
      { home: homeDir, root: worktreeADir }
    );
    await handlePostToolUse(
      { sessionId: sessionAId, tool: "run_command", args: { cmd: "npm run build" }, output: "tsc completed successfully" },
      { home: homeDir }
    );

    const endA = await handleSessionEnd(
      {
        sessionId: sessionAId,
        verified: true,
        verificationCommand: "npm test",
        verificationOutput: "passed",
        taskDescription: "Fix missing dist exports on TypeScript build",
        error: "Cannot find module dist/index.js",
        rootCause: "Build artifacts missing before execution",
        fix: "Run npm run build to generate dist/ output before test suite",
        scope: { repo: repoSlug },
        root: worktreeADir,
      },
      { home: homeDir, root: worktreeADir }
    );
    expect(endA.verified).toBe(true);
    expect(endA.memoriesPromoted).toBeGreaterThan(0);

    const sessionBId = "agent-worktree-b-task-2";
    const startB = await handleSessionStart(
      {
        sessionId: sessionBId,
        taskDescription: "Resolve missing dist exports for integration test",
        scope: { repo: repoSlug },
        root: worktreeBDir,
      },
      { home: homeDir, root: worktreeBDir }
    );

    expect(startB.retrievedMemories.length).toBeGreaterThan(0);
    expect(startB.injectedPrompt).toContain("Burr Learned Memory & Guidance");
    expect(startB.injectedPrompt).toContain("Run npm run build to generate dist/ output before test suite");
  }, 20000);

  it("intercepts and blocks repetitive loop cycles in agent sessions", async () => {
    await runInit(worktreeADir);
    const sessionId = "agent-worktree-loop-test";

    await handleSessionStart(
      {
        sessionId,
        taskDescription: "Fix bug",
        scope: { repo: "sansynx/burr-memory" },
        root: worktreeADir,
      },
      { home: homeDir, root: worktreeADir }
    );

    for (let i = 0; i < 3; i++) {
      await handlePreToolUse(
        { sessionId, tool: "run_command", args: { cmd: "npm test" } },
        { home: homeDir, root: worktreeADir }
      );
      await handlePostToolUse(
        { sessionId, tool: "run_command", args: { cmd: "npm test" }, output: "fail", error: "code 1" },
        { home: homeDir }
      );
    }

    const loopResult = await handlePreToolUse(
      { sessionId, tool: "run_command", args: { cmd: "npm test" } },
      { home: homeDir, root: worktreeADir }
    );

    expect(loopResult.score).toBeGreaterThanOrEqual(50);
    expect(loopResult.suggestedAction).toBeDefined();
  }, 20000);
});
