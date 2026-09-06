import { createHash } from "node:crypto";
import { clip } from "../shared/bounds.js";
import { tokenize } from "../shared/tokens.js";
import type { BurrAction, LoopDetectionResult, LoopRiskLevel, RuntimeConfig } from "../shared/types.js";

export function canonicalize(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val.trim();
  if (typeof val === "number" || typeof val === "boolean") return val;
  if (Array.isArray(val)) return val.map(canonicalize);
  if (typeof val === "object") {
    const keys = Object.keys(val as Record<string, unknown>).sort();
    const sorted: Record<string, unknown> = {};
    for (const k of keys) {
      sorted[k] = canonicalize((val as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return String(val);
}

export function fingerprintInput(tool: string, args: unknown): string {
  const canonical = canonicalize(args);
  const str = `${tool.trim().toLowerCase()}:${JSON.stringify(canonical)}`;
  return createHash("sha256").update(str).digest("hex").slice(0, 16);
}

export function fingerprintOutput(output: unknown): string {
  const text = typeof output === "string" ? output : JSON.stringify(canonicalize(output));
  const normalized = clip(String(text ?? "").trim().replace(/\r\n/g, "\n"), 2000);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function jaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 && tokensB.length === 0) return 1.0;
  if (tokensA.length === 0 || tokensB.length === 0) return 0.0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function extractArgTokens(args: unknown): string[] {
  if (!args) return [];
  if (typeof args === "string") return tokenize(args);
  if (typeof args === "object") {
    const chunks: string[] = [];
    for (const value of Object.values(args as Record<string, unknown>)) {
      if (typeof value === "string") chunks.push(value);
      else if (typeof value === "number" || typeof value === "boolean") chunks.push(String(value));
      else if (typeof value === "object" && value !== null) {
        chunks.push(JSON.stringify(value));
      }
    }
    return tokenize(chunks.join(" "));
  }
  return tokenize(String(args));
}

export function detectExactRepetition(
  currentFingerprint: string,
  recentActions: BurrAction[],
): { detected: boolean; repeatCount: number } {
  let repeatCount = 0;
  for (let i = recentActions.length - 1; i >= 0; i -= 1) {
    const prev = recentActions[i]!;
    if (prev.inputFingerprint === currentFingerprint) {
      repeatCount += 1;
    }
  }
  return {
    detected: repeatCount > 0,
    repeatCount,
  };
}

export function detectFuzzyRepetition(
  tool: string,
  args: unknown,
  recentActions: BurrAction[],
  threshold = 0.85,
): { detected: boolean; similarity: number } {
  const currentTokens = extractArgTokens(args);
  if (currentTokens.length === 0) return { detected: false, similarity: 0 };

  const toolNormalized = tool.trim().toLowerCase();
  let maxSim = 0;

  for (let i = recentActions.length - 1; i >= 0; i -= 1) {
    const prev = recentActions[i]!;
    if (prev.tool.trim().toLowerCase() === toolNormalized) {
      const prevTokens = extractArgTokens(prev.normalizedArgs);
      const sim = jaccardSimilarity(currentTokens, prevTokens);
      if (sim > maxSim) {
        maxSim = sim;
      }
      if (sim >= threshold) {
        return { detected: true, similarity: sim };
      }
    }
  }

  return { detected: maxSim >= threshold, similarity: maxSim };
}

export function detectCycle(
  currentTool: string,
  recentActions: BurrAction[],
): { detected: boolean; pattern?: string[]; length?: number } {
  const tools = recentActions.map((a) => a.tool.trim().toLowerCase());
  tools.push(currentTool.trim().toLowerCase());

  // Check pattern lengths from 2 to 6
  for (let len = 2; len <= 6; len += 1) {
    if (tools.length < len * 2) continue;

    const pattern = tools.slice(tools.length - len);
    let isMatch = true;

    for (let i = 0; i < len; i += 1) {
      if (tools[tools.length - len - 1 - i] !== pattern[pattern.length - 1 - i]) {
        isMatch = false;
        break;
      }
    }

    if (isMatch) {
      return {
        detected: true,
        pattern,
        length: len,
      };
    }
  }

  return { detected: false };
}

export function detectOutputStagnation(
  recentActions: BurrAction[],
): { detected: boolean; count: number } {
  if (recentActions.length < 2) return { detected: false, count: 0 };

  const completed = recentActions.filter(
    (a) => a.status === "completed" || a.status === "failed",
  );
  if (completed.length < 2) return { detected: false, count: 0 };

  const last = completed[completed.length - 1]!;
  if (!last.outputFingerprint) return { detected: false, count: 0 };

  let stagnantCount = 1;
  for (let i = completed.length - 2; i >= 0; i -= 1) {
    const prev = completed[i]!;
    if (
      prev.outputFingerprint === last.outputFingerprint &&
      prev.inputFingerprint !== last.inputFingerprint
    ) {
      stagnantCount += 1;
    } else {
      break;
    }
  }

  return {
    detected: stagnantCount >= 2,
    count: stagnantCount,
  };
}

export function evaluateLoopRisk(
  tool: string,
  args: unknown,
  recentActions: BurrAction[],
  config: RuntimeConfig,
  options: { recentFailedVerify?: boolean } = {},
): LoopDetectionResult {
  if (!config.enabled) {
    return {
      score: 0,
      level: "record",
      reasons: [],
    };
  }

  const windowActions = recentActions.slice(-config.recentWindow);
  const currentFingerprint = fingerprintInput(tool, args);

  const exact = detectExactRepetition(currentFingerprint, windowActions);
  const fuzzy = detectFuzzyRepetition(tool, args, windowActions, config.fuzzyThreshold);
  const cycle = detectCycle(tool, windowActions);
  const stagnation = detectOutputStagnation(windowActions);

  let score = 0;
  const reasons: string[] = [];

  if (exact.detected) {
    score += 40;
    reasons.push("exact-repeat");
  }
  if (fuzzy.detected && !exact.detected) {
    score += 25;
    reasons.push("fuzzy-repeat");
  }
  if (cycle.detected) {
    score += 30;
    reasons.push("cycle");
  }
  if (stagnation.detected) {
    score += 20;
    reasons.push("output-stagnation");
  }
  if (options.recentFailedVerify) {
    score += 10;
    reasons.push("recent-failed-verify");
  }

  const boundedScore = Math.min(100, score);
  let level: LoopRiskLevel = "record";
  if (boundedScore >= config.blockScore) {
    level = "block";
  } else if (boundedScore >= config.warnScore) {
    level = "warn";
  }

  return {
    score: boundedScore,
    level,
    reasons,
    details: {
      repeatCount: exact.repeatCount,
      fuzzySimilarity: fuzzy.similarity,
      cyclePattern: cycle.pattern,
      cycleLength: cycle.length,
      stagnantOutputsCount: stagnation.count,
    },
  };
}
