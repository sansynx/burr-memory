import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluateCandidateAdmission } from "../../src/learning/admission.js";
import {
  applyMemoryDecayAndPruning,
  consolidateMemories,
  trimCandidates,
  getMemory,
  listAllMemories,
  listCandidates,
  mergeCandidate,
  promoteCandidate,
  recordMemoryReuse,
  saveCandidate,
  saveMemoryItem,
} from "../../src/learning/consolidator.js";
import { loadConfig } from "../../src/shared/config.js";
import { runInit } from "../../src/cli/init.js";
import { reflectOnSession } from "../../src/learning/reflection.js";
import { retrieveRelevantMemories } from "../../src/learning/retrieval.js";
import { searchMemoryFiles } from "../../src/shared/search.js";
import { recordAction } from "../../src/runtime/action-ledger.js";
import type { CandidateLesson, MemoryItem } from "../../src/shared/types.js";
import { withTempDir } from "../helpers.js";

function mockCandidate(
  overrides: Partial<CandidateLesson> = {},
): CandidateLesson {
  return {
    id: "cand-123",
    type: "repository-rule",
    statement: "Authentication middleware lives under src/server/auth/",
    scope: { level: "repository", repository: "sansynx/example" },
    evidence: {
      sessionId: "session-1",
      observedCount: 3,
      verified: true,
      verificationCommand: "npm test",
    },
    confidence: 0.8,
    createdAt: new Date().toISOString(),
    status: "candidate",
    ...overrides,
  };
}

describe("learning integrity regressions", () => {
  it("preserves redacted detailed playbook evidence through reflection and promotion", async () => {
    await withTempDir(async (home) => {
      const secret = ["synthetic", "private", "value"].join("-");
      const error = `TypeError ${"detail ".repeat(30)}specific failure`;
      const rootCause =
        "Nested response payload omits the required user identifier";
      const fix = `${"Check the response structure. ".repeat(10)}Read response.user.identifier instead`;
      const result = await reflectOnSession({
        sessionId: "detailed",
        scope: { level: "global" },
        verified: true,
        verificationCommand: "npm test",
        verificationOutput: `14 passed; token=${secret}`,
        error,
        rootCause,
        fix,
        home,
      });
      const candidate = result.candidates.find(
        (entry) => entry.type === "playbook",
      )!;
      await saveCandidate(candidate, home);
      await consolidateMemories(home);
      const item = (await listAllMemories(home))[0]!;
      expect(item.problem).toBe(error);
      expect(item.rootCause).toBe(rootCause);
      expect(item.fix).toBe(fix);
      expect(item.verification?.result).toContain("14 passed");
      expect(item.verification?.result).not.toContain(secret);
      const markdown = await readFile(
        join(home, ".burr/memory/playbooks", `${item.id}.md`),
        "utf8",
      );
      expect(markdown).toContain(rootCause);
      expect(markdown).toContain("Read response.user.identifier instead");
      expect(markdown).not.toContain(secret);
      const other = await reflectOnSession({
        sessionId: "other",
        scope: { level: "global" },
        verified: true,
        error,
        rootCause: "Different cause",
        fix,
        home,
      });
      expect(other.candidates[0]?.id).not.toBe(candidate.id);
      await saveCandidate(other.candidates[0]!, home);
      await consolidateMemories(home);
      expect(await listAllMemories(home)).toHaveLength(2);
    });
  });

  it("moves a directly saved status transition without duplicate memory files", async () => {
    await withTempDir(async (home) => {
      const item = await promoteCandidate(
        mockCandidate({ type: "playbook" }),
        home,
      );
      await saveMemoryItem({ ...item, status: "archived" }, home);
      expect(await listAllMemories(home)).toHaveLength(1);
      expect((await getMemory(item.id, home))?.status).toBe("archived");
      expect(
        await searchMemoryFiles(home, "Authentication middleware", { home }),
      ).toEqual([]);
      await saveMemoryItem(item, home);
      expect(await listAllMemories(home)).toHaveLength(1);
      expect((await getMemory(item.id, home))?.status).toBe("active");
    });
  });

  it("consolidates concurrently without duplicate promotions or replayed evidence", async () => {
    await withTempDir(async (home) => {
      const candidate = mockCandidate();
      await saveCandidate(candidate, home);
      await Promise.all([
        consolidateMemories(home),
        consolidateMemories(home),
        applyMemoryDecayAndPruning(home),
      ]);
      let memories = await listAllMemories(home);
      expect(memories).toHaveLength(1);
      expect(memories[0]?.evidence.observed).toBe(3);
      await saveCandidate(candidate, home);
      await consolidateMemories(home);
      memories = await listAllMemories(home);
      expect(memories[0]?.evidence.observed).toBe(3);
      expect(await listCandidates(home)).toEqual([]);
    });
  });

  it("serializes concurrent reuse and counts a merged session only once", async () => {
    await withTempDir(async (home) => {
      const item = await promoteCandidate(mockCandidate(), home);
      await Promise.all(
        Array.from({ length: 10 }, () =>
          recordMemoryReuse(item.id, true, home),
        ),
      );
      expect((await getMemory(item.id, home))?.evidence.successfulReuse).toBe(
        10,
      );
      const candidate = mockCandidate({
        id: "cand-replay",
        evidence: { sessionId: "session-2", observedCount: 2, verified: true },
      });
      await Promise.all(
        Array.from({ length: 4 }, () =>
          mergeCandidate(candidate, item.id, home),
        ),
      );
      const merged = await getMemory(item.id, home);
      expect(merged?.evidence.observed).toBe(5);
      expect(merged?.statement).toBe(item.statement);
    });
  });

  it("ignores invalid records and mismatched filenames", async () => {
    await withTempDir(async (home) => {
      const item = await promoteCandidate(mockCandidate(), home);
      await writeFile(
        join(home, ".burr/memory/knowledge/bad.json"),
        JSON.stringify({ id: "bad", status: "active" }),
      );
      await writeFile(
        join(home, ".burr/memory/knowledge/wrong.json"),
        JSON.stringify(item),
      );
      await writeFile(
        join(home, ".burr/candidates/bad.json"),
        JSON.stringify({
          id: "bad",
          statement: "This candidate has no evidence",
        }),
      );
      expect(await listAllMemories(home)).toHaveLength(1);
      expect(await listCandidates(home)).toEqual([]);
      await expect(retrieveRelevantMemories({ home })).resolves.toBeDefined();
      await expect(consolidateMemories(home)).resolves.toEqual({
        promoted: 0,
        merged: 0,
        discarded: 0,
      });
    });
  });

  it("keeps every scope dimension in admission and candidate identity", async () => {
    await withTempDir(async (home) => {
      const scope = {
        level: "framework" as const,
        framework: "react",
        package: "router",
        packageVersion: "1",
        tool: "test",
        language: "typescript",
      };
      const item = await promoteCandidate(mockCandidate({ scope }), home);
      for (const key of [
        "framework",
        "package",
        "packageVersion",
        "tool",
        "language",
      ] as const) {
        expect(
          evaluateCandidateAdmission(
            mockCandidate({ scope: { ...scope, [key]: "different" } }),
            [item],
          ).decision,
        ).toBe("promote");
      }
      const input = {
        sessionId: "empty",
        verified: true,
        error: "Synthetic error",
        rootCause: "Missing guard",
        fix: "Add the guard",
        home,
      };
      const first = await reflectOnSession({ ...input, scope });
      const second = await reflectOnSession({
        ...input,
        scope: { ...scope, framework: "vue" },
      });
      expect(first.candidates[0]?.id).not.toBe(second.candidates[0]?.id);
    });
  });

  it("removes archived playbooks from markdown search and revives new evidence", async () => {
    await withTempDir(async (home) => {
      const candidate = mockCandidate({ type: "playbook" });
      const item = await promoteCandidate(candidate, home);
      item.evidence.lastUsed = new Date(0).toISOString();
      await saveMemoryItem(item, home);
      await applyMemoryDecayAndPruning(home);
      expect(
        await searchMemoryFiles(home, "Authentication middleware", { home }),
      ).toEqual([]);
      await mergeCandidate(
        {
          ...candidate,
          evidence: { ...candidate.evidence, sessionId: "new-session" },
        },
        item.id,
        home,
      );
      expect((await getMemory(item.id, home))?.status).toBe("active");
      expect(
        (await listAllMemories(home)).filter((memory) => memory.id === item.id),
      ).toHaveLength(1);
    });
  });
});

describe("Memory Lifecycle: Admission, Consolidation & Decay", () => {
  describe("candidate admission evaluation", () => {
    it("discards unverified candidates", () => {
      const unverified = mockCandidate({
        evidence: { sessionId: "s1", observedCount: 1, verified: false },
      });
      const decision = evaluateCandidateAdmission(unverified, []);
      expect(decision.decision).toBe("discard");
      expect(decision.reason).toBe("unverified-outcome");
    });

    it("discards ephemeral or noisy statements", () => {
      const noisy = mockCandidate({
        statement: "Agent opened src/foo.ts at 14:31 and got confused.",
      });
      const decision = evaluateCandidateAdmission(noisy, []);
      expect(decision.decision).toBe("discard");
      expect(decision.reason).toBe("ephemeral-or-noisy-statement");
    });

    it("promotes novel verified candidates", () => {
      const novel = mockCandidate({
        statement: "Run targeted auth tests before executing the full suite.",
      });
      const decision = evaluateCandidateAdmission(novel, []);
      expect(decision.decision).toBe("promote");
      expect(decision.reason).toBe("verified-novel-lesson");
    });

    it("merges duplicate candidates into existing memories", () => {
      const candidate = mockCandidate({
        statement:
          "Authentication middleware lives under src/server/auth/callback.ts",
      });
      const existing: MemoryItem = {
        id: "mem-auth-1",
        title: "Auth middleware lives under src/server/auth/",
        type: "knowledge",
        statement: "Authentication middleware lives under src/server/auth/",
        scope: { level: "repository", repository: "sansynx/example" },
        evidence: { observed: 2, successfulReuse: 1, failedReuse: 0 },
        confidence: 0.85,
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const decision = evaluateCandidateAdmission(candidate, [existing]);
      expect(decision.decision).toBe("merge");
      expect(decision.targetMemoryId).toBe("mem-auth-1");
    });
  });

  describe("promotion and merging", () => {
    it("rejects candidate ids that escape the candidates directory", async () => {
      await withTempDir(async (home) => {
        await expect(
          saveCandidate(mockCandidate({ id: "../escaped" }), home),
        ).rejects.toThrow();
      });
    });
    it("redacts persisted candidate evidence and memory statements", async () => {
      await withTempDir(async (home) => {
        const secret = ["synthetic", "learning", "credential"].join("-");
        const candidate = mockCandidate({
          statement: `Configure token=${secret} before testing`,
        });
        candidate.evidence.verificationCommand = `run password=${secret}`;
        await saveCandidate(candidate, home);
        expect(JSON.stringify(await listCandidates(home))).not.toContain(
          secret,
        );
        await promoteCandidate(candidate, home);
        expect(JSON.stringify(await listAllMemories(home))).not.toContain(
          secret,
        );
      });
    });
    it("promotes candidate to active memory and deletes candidate", async () => {
      await withTempDir(async (home) => {
        const candidate = mockCandidate({ id: "cand-promo" });
        await saveCandidate(candidate, home);

        const beforeList = await listCandidates(home);
        expect(beforeList).toHaveLength(1);

        const memory = await promoteCandidate(candidate, home);
        expect(memory.id).toBe("mem-promo");
        expect(memory.status).toBe("active");

        const afterList = await listCandidates(home);
        expect(afterList).toHaveLength(0);

        const loaded = await getMemory("mem-promo", home);
        expect(loaded).not.toBeNull();
        expect(loaded!.statement).toBe(candidate.statement);
      });
    });

    it("merges candidate into existing memory, increasing observed count and confidence", async () => {
      await withTempDir(async (home) => {
        const candidate1 = mockCandidate({
          id: "cand-base",
          statement: "Run targeted unit tests first.",
        });
        const mem = await promoteCandidate(candidate1, home);
        const initialConf = mem.confidence;

        const candidate2 = mockCandidate({
          id: "cand-next",
          statement: "Targeted tests run faster.",
        });
        const merged = await mergeCandidate(candidate2, mem.id, home);

        expect(merged.id).toBe(mem.id);
        expect(merged.confidence).toBeGreaterThan(initialConf);
        expect(merged.evidence.observed).toBeGreaterThan(mem.evidence.observed);
      });
    });
  });

  describe("confidence adjustment on reuse", () => {
    it("increases confidence on successful reuse, decreases on failed reuse", async () => {
      await withTempDir(async (home) => {
        const candidate = mockCandidate({ id: "cand-conf" });
        const mem = await promoteCandidate(candidate, home);
        const baseConf = mem.confidence;

        // Success reuse -> +0.05
        const afterSuccess = await recordMemoryReuse(mem.id, true, home);
        expect(afterSuccess!.confidence).toBeGreaterThan(baseConf);
        expect(afterSuccess!.evidence.successfulReuse).toBe(1);

        // Failed reuse -> -0.15
        const afterFailure = await recordMemoryReuse(mem.id, false, home);
        expect(afterFailure!.confidence).toBeLessThan(afterSuccess!.confidence);
        expect(afterFailure!.evidence.failedReuse).toBe(1);
      });
    });
  });

  describe("decay and pruning", () => {
    it("archives a memory that was previously made stale", async () => {
      await withTempDir(async (home) => {
        const item = await promoteCandidate(
          mockCandidate({ id: "cand-stale" }),
          home,
        );
        item.status = "stale";
        item.evidence.lastUsed = new Date(
          Date.now() - 70 * 86400000,
        ).toISOString();
        await saveMemoryItem(item, home);
        expect((await applyMemoryDecayAndPruning(home)).archived).toBe(1);
        expect((await getMemory(item.id, home))?.status).toBe("archived");
      });
    });

    it("does not delete a path supplied in a stored memory id", async () => {
      await withTempDir(async (home) => {
        const item = await promoteCandidate(
          mockCandidate({ id: "cand-traversal" }),
          home,
        );
        const victim = join(home, "keep.json");
        await writeFile(victim, "keep");
        item.id = "../../../keep";
        item.evidence.lastUsed = new Date(0).toISOString();
        await writeFile(
          join(home, ".burr", "memory", "knowledge", "mem-traversal.json"),
          JSON.stringify(item),
        );
        await applyMemoryDecayAndPruning(home).catch(() => undefined);
        expect(await readFile(victim, "utf8")).toBe("keep");
      });
    });
    it("transitions stale memories and cleans up archive", async () => {
      await withTempDir(async (home) => {
        const candidate = mockCandidate({ id: "cand-decay" });
        const mem = await promoteCandidate(candidate, home);

        // Fail reuse repeatedly to drop score
        await recordMemoryReuse(mem.id, false, home);
        await recordMemoryReuse(mem.id, false, home);
        await recordMemoryReuse(mem.id, false, home);

        const result = await applyMemoryDecayAndPruning(home, 10);
        expect(result.staled + result.archived).toBeGreaterThanOrEqual(1);

        const all = await listAllMemories(home);
        const updated = all.find((m) => m.id === mem.id);
        expect(["stale", "archived"]).toContain(updated?.status);
      });
    });
  });

  describe("self-reflection after verified session", () => {
    it("generates structured candidates after verified run", async () => {
      await withTempDir(async (home) => {
        const sessionId = "reflect-session";
        await recordAction(home, {
          sessionId,
          harness: "codex",
          tool: "search",
          normalizedArgs: { query: "auth token" },
          inputFingerprint: "fp-1",
          status: "completed",
        });

        await recordAction(home, {
          sessionId,
          harness: "codex",
          tool: "read",
          normalizedArgs: { path: "src/server/auth/callback.ts" },
          inputFingerprint: "fp-2",
          status: "completed",
        });

        await recordAction(home, {
          sessionId,
          harness: "codex",
          tool: "test",
          normalizedArgs: { cmd: "npm test auth" },
          inputFingerprint: "fp-3",
          status: "completed",
        });

        const result = await reflectOnSession({
          sessionId,
          scope: { level: "repository", repository: "sansynx/example" },
          verified: true,
          verificationCommand: "npm test auth",
          taskDescription: "Fix OAuth callback token validation",
          home,
        });

        expect(result.verified).toBe(true);
        expect(result.usefulTools).toContain("search");
        expect(result.usefulTools).toContain("read");
        expect(result.candidates.length).toBeGreaterThan(0);

        const repoCandidate = result.candidates.find(
          (c) => c.type === "repository-rule",
        );
        expect(repoCandidate).toBeDefined();
        expect(repoCandidate!.statement).toContain(
          "src/server/auth/callback.ts",
        );
      });
    });
  });
});

describe("candidate retention", () => {
  it("keeps the newest candidates within the configured limit", async () => {
    await withTempDir(async (home) => {
      for (let n = 1; n <= 3; n++) {
        await saveCandidate(
          mockCandidate({
            id: `retention-${n}`,
            createdAt: `2026-09-0${n}T00:00:00Z`,
          }),
          home,
        );
      }
      expect(await trimCandidates(home, 2)).toBe(1);
      expect((await listCandidates(home)).map((c) => c.id).sort()).toEqual([
        "retention-2",
        "retention-3",
      ]);
    });
  });
});

it("falls back for fractional candidate limits", async () => {
  await withTempDir(async (root) => {
    await runInit(root);
    await writeFile(
      join(root, ".burr", "config.json"),
      JSON.stringify({ memory: { maxCandidates: 2.5 } }),
    );
    expect((await loadConfig(root)).memory.maxCandidates).toBe(100);
  });
});
