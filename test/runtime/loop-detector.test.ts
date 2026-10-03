import { describe, expect, it } from "vitest";
import {
  canonicalize,
  detectCycle,
  detectExactRepetition,
  detectFuzzyRepetition,
  detectOutputStagnation,
  evaluateLoopRisk,
  extractArgTokens,
  fingerprintInput,
  fingerprintOutput,
  jaccardSimilarity,
} from "../../src/runtime/loop-detector.js";
import { DEFAULT_RUNTIME_CONFIG } from "../../src/shared/config.js";
import type { BurrAction } from "../../src/shared/types.js";

function mockAction(overrides: Partial<BurrAction> = {}): BurrAction {
  return {
    sessionId: "test-session",
    sequence: 1,
    timestamp: new Date().toISOString(),
    harness: "codex",
    tool: "search",
    normalizedArgs: { query: "prisma client" },
    inputFingerprint: "fp-1",
    status: "completed",
    ...overrides,
  };
}

describe("Loop Detector", () => {
  it("does not block productive repeated verification", () => {
    const actions = [
      mockAction({
        tool: "test",
        normalizedArgs: { cmd: "test" },
        inputFingerprint: fingerprintInput("test", { cmd: "test" }),
        outputFingerprint: "one-passed",
      }),
      mockAction({
        tool: "edit",
        inputFingerprint: "edit-a",
        outputFingerprint: "saved-a",
      }),
      mockAction({
        tool: "test",
        normalizedArgs: { cmd: "test" },
        inputFingerprint: fingerprintInput("test", { cmd: "test" }),
        outputFingerprint: "two-passed",
      }),
      mockAction({
        tool: "edit",
        inputFingerprint: "edit-b",
        outputFingerprint: "saved-b",
      }),
    ];
    expect(
      evaluateLoopRisk("test", { cmd: "test" }, actions, DEFAULT_RUNTIME_CONFIG)
        .level,
    ).not.toBe("block");
  });
  describe("canonicalize and fingerprinting", () => {
    it("canonicalizes object keys in sorted order and trims strings", () => {
      const obj1 = { b: " test ", a: 1 };
      const obj2 = { a: 1, b: "test" };
      expect(JSON.stringify(canonicalize(obj1))).toBe(
        JSON.stringify(canonicalize(obj2)),
      );
    });

    it("fingerprints input deterministically", () => {
      const fp1 = fingerprintInput("search", { query: "foo bar" });
      const fp2 = fingerprintInput("search", { query: "foo bar" });
      const fp3 = fingerprintInput("search", { query: "baz" });
      expect(fp1).toBe(fp2);
      expect(fp1).not.toBe(fp3);
    });

    it("fingerprints output deterministically with normalization", () => {
      const out1 = fingerprintOutput("hello\r\nworld");
      const out2 = fingerprintOutput("hello\nworld");
      expect(out1).toBe(out2);
    });
  });

  describe("exact repetition", () => {
    it("detects exact repeated tool calls with identical fingerprints", () => {
      const actions = [
        mockAction({ inputFingerprint: "fp-search-1" }),
        mockAction({ inputFingerprint: "fp-search-1" }),
      ];

      const res = detectExactRepetition("fp-search-1", actions);
      expect(res.detected).toBe(true);
      expect(res.repeatCount).toBe(2);

      const noMatch = detectExactRepetition("fp-other", actions);
      expect(noMatch.detected).toBe(false);
    });
  });

  describe("fuzzy repetition", () => {
    it("computes Jaccard similarity correctly", () => {
      const tokensA = ["prisma", "duplicate", "client"];
      const tokensB = ["duplicate", "prisma", "client"];
      expect(jaccardSimilarity(tokensA, tokensB)).toBe(1.0);

      const tokensC = ["prisma", "duplicate", "client", "error"];
      expect(jaccardSimilarity(tokensA, tokensC)).toBe(0.75);
    });

    it("detects fuzzy repetition when Jaccard similarity >= threshold", () => {
      const actions = [
        mockAction({
          tool: "search",
          normalizedArgs: { query: "prisma duplicate client" },
        }),
      ];

      const res = detectFuzzyRepetition(
        "search",
        { query: "duplicate prisma client" },
        actions,
        0.85,
      );
      expect(res.detected).toBe(true);
      expect(res.similarity).toBe(1.0);

      const distant = detectFuzzyRepetition(
        "search",
        { query: "unrelated nextjs routing bug" },
        actions,
        0.85,
      );
      expect(distant.detected).toBe(false);
    });
  });

  describe("cycles", () => {
    it("detects repeated tool sequence cycles of length 2 to 6", () => {
      // Sequence: grep -> read -> test -> grep -> read -> test
      const actions = [
        mockAction({ tool: "grep" }),
        mockAction({ tool: "read" }),
        mockAction({ tool: "test" }),
        mockAction({ tool: "grep" }),
        mockAction({ tool: "read" }),
      ];

      // Next action is test
      const res = detectCycle("test", actions);
      expect(res.detected).toBe(true);
      expect(res.length).toBe(3);
      expect(res.pattern).toEqual(["grep", "read", "test"]);
    });

    it("does not report cycles for non-repeating sequences", () => {
      const actions = [
        mockAction({ tool: "grep" }),
        mockAction({ tool: "read" }),
        mockAction({ tool: "edit" }),
        mockAction({ tool: "test" }),
      ];
      const res = detectCycle("commit", actions);
      expect(res.detected).toBe(false);
    });
  });

  describe("output stagnation", () => {
    it("detects output stagnation across different input actions returning identical output", () => {
      const actions = [
        mockAction({
          inputFingerprint: "inp-1",
          outputFingerprint: "out-same",
          status: "completed",
        }),
        mockAction({
          inputFingerprint: "inp-2",
          outputFingerprint: "out-same",
          status: "completed",
        }),
      ];

      const res = detectOutputStagnation(actions);
      expect(res.detected).toBe(true);
      expect(res.count).toBe(2);
    });

    it("does not flag stagnation when outputs change", () => {
      const actions = [
        mockAction({
          inputFingerprint: "inp-1",
          outputFingerprint: "out-1",
          status: "completed",
        }),
        mockAction({
          inputFingerprint: "inp-2",
          outputFingerprint: "out-2",
          status: "completed",
        }),
      ];

      const res = detectOutputStagnation(actions);
      expect(res.detected).toBe(false);
    });
  });

  describe("risk scoring & thresholds", () => {
    it("assigns appropriate score and level: record (< 50), warn (>= 50), block (>= 70)", () => {
      // 1. Safe action
      const safe = evaluateLoopRisk(
        "search",
        { query: "unique query" },
        [],
        DEFAULT_RUNTIME_CONFIG,
      );
      expect(safe.score).toBe(0);
      expect(safe.level).toBe("record");

      // 2. Exact repeat alone (+40) -> record (< 50)
      const fp = fingerprintInput("search", { query: "prisma error" });
      const actionsWithExact = [mockAction({ inputFingerprint: fp })];
      const exactOnly = evaluateLoopRisk(
        "search",
        { query: "prisma error" },
        actionsWithExact,
        DEFAULT_RUNTIME_CONFIG,
      );
      expect(exactOnly.score).toBe(40);
      expect(exactOnly.level).toBe("record");
      expect(exactOnly.reasons).toContain("exact-repeat");

      // 3. Exact repeat (+40) + Cycle (+30) = 70 -> block (>= 70)
      const cycleActions = [
        mockAction({ tool: "search", inputFingerprint: fp, status: "failed" }),
        mockAction({ tool: "read" }),
        mockAction({ tool: "search", inputFingerprint: fp, status: "failed" }),
        mockAction({ tool: "read" }),
      ];
      const blocked = evaluateLoopRisk(
        "search",
        { query: "prisma error" },
        cycleActions,
        DEFAULT_RUNTIME_CONFIG,
      );
      expect(blocked.score).toBe(70);
      expect(blocked.level).toBe("block");
      expect(blocked.reasons).toContain("exact-repeat");
      expect(blocked.reasons).toContain("cycle");

      // 4. Exact repeat (+40) + recent failed verify (+10) = 50 -> warn (>= 50)
      const warned = evaluateLoopRisk(
        "search",
        { query: "prisma error" },
        actionsWithExact,
        DEFAULT_RUNTIME_CONFIG,
        { recentFailedVerify: true },
      );
      expect(warned.score).toBe(50);
      expect(warned.level).toBe("warn");
    });
  });
});
