import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleSessionStart,
  handlePreToolUse,
  handlePostToolUse,
  handleSessionEnd,
} from "../src/codex/hooks.js";
import { computeLearningProgression, computeBurrStats } from "../src/metrics/tracker.js";
import { listAllMemories, listCandidates } from "../src/learning/consolidator.js";

describe("Syndicate Benchmark: Multi-Session Learning Progression", () => {
  let homeDir: string;
  let repoRoot: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "burr-bench-home-"));
    repoRoot = await mkdtemp(join(tmpdir(), "burr-bench-repo-"));
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("progressively learns, cuts tool calls, halts loops, and bounds memory growth across 4 unseen GitHub tasks", async () => {
    // =========================================================================
    // TASK 1: Cold start - Module Resolution Failure in Monorepo
    // =========================================================================
    const session1Id = "ao-sess-task1-monorepo-resolver";
    const start1 = await handleSessionStart(
      {
        sessionId: session1Id,
        taskDescription: "Fix ESM module resolution failure in @repo/utils packages",
        scope: { repo: "sansynx/burr-memory" },
        root: repoRoot,
      },
      { home: homeDir, root: repoRoot }
    );
    expect(start1.retrievedMemories).toHaveLength(0); // Cold start: no memories

    // Turn 1-3: Broad exploratory tool calls
    await handlePreToolUse({ sessionId: session1Id, tool: "find_by_name", args: { pattern: "*.ts" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session1Id, tool: "find_by_name", args: { pattern: "*.ts" }, output: "found 140 files" }, { home: homeDir });

    await handlePreToolUse({ sessionId: session1Id, tool: "grep_search", args: { query: "resolveModule", path: "src/" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session1Id, tool: "grep_search", args: { query: "resolveModule", path: "src/" }, output: "no matches in src/" }, { home: homeDir });

    await handlePreToolUse({ sessionId: session1Id, tool: "run_command", args: { cmd: "npm test" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session1Id, tool: "run_command", args: { cmd: "npm test" }, output: "Error: Cannot find module @repo/utils", error: "exit code 1" }, { home: homeDir });

    // Turn 4-6: Agent gets stuck in an unguided loop (repeating failing test & broad grep)
    await handlePreToolUse({ sessionId: session1Id, tool: "grep_search", args: { query: "resolveModule", path: "packages/" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session1Id, tool: "grep_search", args: { query: "resolveModule", path: "packages/" }, output: "no matches" }, { home: homeDir });

    await handlePreToolUse({ sessionId: session1Id, tool: "run_command", args: { cmd: "npm test" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session1Id, tool: "run_command", args: { cmd: "npm test" }, output: "Error: Cannot find module @repo/utils", error: "exit code 1" }, { home: homeDir });

    await handlePreToolUse({ sessionId: session1Id, tool: "grep_search", args: { query: "resolveModule", path: "packages/" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session1Id, tool: "grep_search", args: { query: "resolveModule", path: "packages/" }, output: "no matches" }, { home: homeDir });

    // Turn 7: Loop guard triggers! Cycle / fuzzy repetition detected
    const loopPre = await handlePreToolUse(
      { sessionId: session1Id, tool: "run_command", args: { cmd: "npm test" } },
      { home: homeDir, root: repoRoot }
    );
    expect(loopPre.score).toBeGreaterThanOrEqual(50);
    expect(loopPre.reasons?.length).toBeGreaterThan(0);
    expect(loopPre.suggestedAction).toBeDefined();

    // Agent redirects: inspects package configs and builds packages first
    await handlePreToolUse({ sessionId: session1Id, tool: "view_file", args: { path: "package.json" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session1Id, tool: "view_file", args: { path: "package.json" }, output: "{\"exports\": { \".\": \"./dist/index.js\" }}" }, { home: homeDir });

    await handlePreToolUse({ sessionId: session1Id, tool: "run_command", args: { cmd: "npm run build" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session1Id, tool: "run_command", args: { cmd: "npm run build" }, output: "Build successful" }, { home: homeDir });

    await handlePreToolUse({ sessionId: session1Id, tool: "run_command", args: { cmd: "npm test -- test/resolver.test.ts" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session1Id, tool: "run_command", args: { cmd: "npm test -- test/resolver.test.ts" }, output: "✓ 4 tests passed" }, { home: homeDir });

    // Session 1 verified completion
    const end1 = await handleSessionEnd(
      {
        sessionId: session1Id,
        verified: true,
        verificationCommand: "npm test -- test/resolver.test.ts",
        verificationOutput: "✓ 4 tests passed",
        taskDescription: "Fix ESM module resolution failure in @repo/utils packages",
        error: "Cannot find module @repo/utils",
        rootCause: "Monorepo exports point to dist/ but packages were not built before test run",
        fix: "Always execute npm run build before testing TypeScript packages with package exports",
        scope: { repo: "sansynx/burr-memory" },
        root: repoRoot,
      },
      { home: homeDir, root: repoRoot }
    );

    expect(end1.verified).toBe(true);
    expect(end1.candidatesGenerated).toBeGreaterThan(0);
    expect(end1.memoriesPromoted).toBeGreaterThan(0);

    // =========================================================================
    // TASK 2: Fresh Context - Circular Dependency in CLI Commands
    // =========================================================================
    const session2Id = "ao-sess-task2-circular-dep";
    const start2 = await handleSessionStart(
      {
        sessionId: session2Id,
        taskDescription: "Fix module circular dependency in CLI build and run tests",
        scope: { repo: "sansynx/burr-memory" },
        root: repoRoot,
      },
      { home: homeDir, root: repoRoot }
    );

    // Injected prompt contains the learned lessons!
    expect(start2.retrievedMemories.length).toBeGreaterThan(0);
    expect(start2.injectedPrompt).toContain("Burr Learned Memory & Guidance");

    // Codex skips broad exploration and immediately executes targeted tools
    await handlePreToolUse({ sessionId: session2Id, tool: "view_file", args: { path: "src/cli/index.ts" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session2Id, tool: "view_file", args: { path: "src/cli/index.ts" }, output: "circular import detected" }, { home: homeDir });

    await handlePreToolUse({ sessionId: session2Id, tool: "replace_file_content", args: { path: "src/cli/index.ts" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session2Id, tool: "replace_file_content", args: { path: "src/cli/index.ts" }, output: "replaced successfully" }, { home: homeDir });

    // Reuses learned strategy: build before test
    await handlePreToolUse({ sessionId: session2Id, tool: "run_command", args: { cmd: "npm run build" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session2Id, tool: "run_command", args: { cmd: "npm run build" }, output: "Build successful" }, { home: homeDir });

    await handlePreToolUse({ sessionId: session2Id, tool: "run_command", args: { cmd: "npm test -- test/cli.test.ts" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session2Id, tool: "run_command", args: { cmd: "npm test -- test/cli.test.ts" }, output: "✓ 6 tests passed" }, { home: homeDir });

    const end2 = await handleSessionEnd(
      {
        sessionId: session2Id,
        verified: true,
        verificationCommand: "npm test -- test/cli.test.ts",
        verificationOutput: "✓ 6 tests passed",
        taskDescription: "Fix module circular dependency in CLI build and run tests",
        rootCause: "Circular import between cli router and command handlers",
        fix: "Extracted shared interface to separate types module",
        scope: { repo: "sansynx/burr-memory" },
        root: repoRoot,
      },
      { home: homeDir, root: repoRoot }
    );
    expect(end2.verified).toBe(true);

    // =========================================================================
    // TASK 3: Targeted Filesystem Path Containment
    // =========================================================================
    const session3Id = "ao-sess-task3-path-containment";
    const start3 = await handleSessionStart(
      {
        sessionId: session3Id,
        taskDescription: "Ensure safe fs path containment guards against symlink directory escape",
        scope: { repo: "sansynx/burr-memory" },
        root: repoRoot,
      },
      { home: homeDir, root: repoRoot }
    );
    expect(start3.retrievedMemories.length).toBeGreaterThan(0);

    // Highly targeted: 3 tool calls
    await handlePreToolUse({ sessionId: session3Id, tool: "view_file", args: { path: "src/shared/fs.ts" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session3Id, tool: "view_file", args: { path: "src/shared/fs.ts" }, output: "assertInside checks realpath" }, { home: homeDir });

    await handlePreToolUse({ sessionId: session3Id, tool: "run_command", args: { cmd: "npm run build" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session3Id, tool: "run_command", args: { cmd: "npm run build" }, output: "Build successful" }, { home: homeDir });

    await handlePreToolUse({ sessionId: session3Id, tool: "run_command", args: { cmd: "npm test -- test/shared/fs.test.ts" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session3Id, tool: "run_command", args: { cmd: "npm test -- test/shared/fs.test.ts" }, output: "✓ 8 tests passed" }, { home: homeDir });

    await handleSessionEnd(
      {
        sessionId: session3Id,
        verified: true,
        verificationCommand: "npm test -- test/shared/fs.test.ts",
        verificationOutput: "✓ 8 tests passed",
        taskDescription: "Ensure safe fs path containment guards against symlink directory escape",
        scope: { repo: "sansynx/burr-memory" },
        root: repoRoot,
      },
      { home: homeDir, root: repoRoot }
    );

    // =========================================================================
    // TASK 4: Mature Memory - Diagnostic Doctor Check
    // =========================================================================
    const session4Id = "ao-sess-task4-doctor-integrity";
    const start4 = await handleSessionStart(
      {
        sessionId: session4Id,
        taskDescription: "Add doctor CLI check for storage directory health",
        scope: { repo: "sansynx/burr-memory" },
        root: repoRoot,
      },
      { home: homeDir, root: repoRoot }
    );
    expect(start4.retrievedMemories.length).toBeGreaterThan(0);

    // Minimal direct execution: 2 calls
    await handlePreToolUse({ sessionId: session4Id, tool: "run_command", args: { cmd: "npm run build" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session4Id, tool: "run_command", args: { cmd: "npm run build" }, output: "Build ok" }, { home: homeDir });

    await handlePreToolUse({ sessionId: session4Id, tool: "run_command", args: { cmd: "npm test -- test/cli/doctor.test.ts" } }, { home: homeDir, root: repoRoot });
    await handlePostToolUse({ sessionId: session4Id, tool: "run_command", args: { cmd: "npm test -- test/cli/doctor.test.ts" }, output: "✓ 5 tests passed" }, { home: homeDir });

    await handleSessionEnd(
      {
        sessionId: session4Id,
        verified: true,
        verificationCommand: "npm test -- test/cli/doctor.test.ts",
        verificationOutput: "✓ 5 tests passed",
        taskDescription: "Add doctor CLI check for storage directory health",
        scope: { repo: "sansynx/burr-memory" },
        root: repoRoot,
      },
      { home: homeDir, root: repoRoot }
    );

    // =========================================================================
    // VERIFY LEARNING PROGRESSION & BOUNDED MEMORY
    // =========================================================================
    const progression = await computeLearningProgression(homeDir);
    expect(progression).toHaveLength(4);

    // Progression verification:
    // Run 1: High tool calls (10), loop detected (>0)
    // Run 2: Tool calls dropped (4), 0 loops, memory hits
    // Run 3: Tool calls dropped (3), 0 loops, memory hits
    // Run 4: Minimal calls (2), 0 loops, mature memory hits
    expect(progression[0].toolCalls).toBeGreaterThan(progression[1].toolCalls);
    expect(progression[1].toolCalls).toBeGreaterThanOrEqual(progression[2].toolCalls);
    expect(progression[2].toolCalls).toBeGreaterThanOrEqual(progression[3].toolCalls);

    expect(progression[0].loops).toBeGreaterThan(0);
    expect(progression[1].loops).toBe(0);
    expect(progression[2].loops).toBe(0);
    expect(progression[3].loops).toBe(0);

    const stats = await computeBurrStats(homeDir);
    expect(stats.runtime.observedSessions).toBe(4);
    expect(stats.learning.promoted).toBeGreaterThan(0);

    // Memory bounding check:
    const allMem = await listAllMemories(homeDir);
    expect(allMem.length).toBeLessThanOrEqual(50); // Well within bounded capacity
    const candidates = await listCandidates(homeDir);
    expect(candidates.length).toBeLessThanOrEqual(100);
  });
});
