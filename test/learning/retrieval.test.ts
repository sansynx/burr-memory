import { describe, expect, it } from "vitest";
import { promoteCandidate } from "../../src/learning/consolidator.js";
import {
  formatRetrievedMemoriesForContext,
  retrieveRelevantMemories,
} from "../../src/learning/retrieval.js";
import type { CandidateLesson } from "../../src/shared/types.js";
import { withTempDir } from "../helpers.js";

function makeCand(id: string, stmt: string, repo = "sansynx/example"): CandidateLesson {
  return {
    id: `cand-${id}`,
    type: "knowledge",
    statement: stmt,
    scope: { level: "repository", repository: repo },
    evidence: { sessionId: "s1", observedCount: 2, verified: true },
    confidence: 0.9,
    createdAt: new Date().toISOString(),
    status: "candidate",
  };
}

describe("Deterministic Retrieval", () => {
  it("retrieves top-k relevant memories based on scope and token overlap", async () => {
    await withTempDir(async (home) => {
      await promoteCandidate(makeCand("auth", "Auth middleware is under src/server/auth/"), home);
      await promoteCandidate(makeCand("prisma", "Prisma migrations must run with --name flag"), home);
      await promoteCandidate(makeCand("other", "Unrelated python rule", "other/repo"), home);

      const hits = await retrieveRelevantMemories({
        scope: { level: "repository", repository: "sansynx/example" },
        taskDescription: "Fix authentication token issue in middleware",
        limit: 5,
        home,
      });

      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.item.statement).toContain("Auth middleware");
      // Other repository memory should be excluded
      const otherMatch = hits.find((h) => h.item.statement.includes("python"));
      expect(otherMatch).toBeUndefined();
    });
  });

  it("formats retrieved memories cleanly for context injection", async () => {
    await withTempDir(async (home) => {
      await promoteCandidate(
        {
          id: "cand-tool",
          type: "tool-strategy",
          statement: "Inspect route registration first before running test suite.",
          scope: { level: "global" },
          evidence: { sessionId: "s1", observedCount: 2, verified: true },
          confidence: 0.85,
          createdAt: new Date().toISOString(),
          status: "candidate",
        },
        home,
      );

      const retrieved = await retrieveRelevantMemories({
        taskDescription: "debug routing registration",
        home,
      });

      expect(retrieved.length).toBeGreaterThan(0);
      const prompt = formatRetrievedMemoriesForContext(retrieved);
      expect(prompt).toContain("burr:active-memory");
      expect(prompt).toContain("Inspect route registration");
    });
  });
});
