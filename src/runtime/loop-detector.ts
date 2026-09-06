import { createHash } from "node:crypto";
import { clip } from "../shared/bounds.js";
import { tokenize } from "../shared/tokens.js";
import type { BurrAction, LoopDetectionResult, LoopRiskLevel, RuntimeConfig } from "../shared/types.js";
import { DEFAULT_RUNTIME_CONFIG } from "../shared/config.js";

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

export function setJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  let intersection = 0;
  for (const t of smaller) {
    if (larger.has(t)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function jaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 && tokensB.length === 0) return 1.0;
  if (tokensA.length === 0 || tokensB.length === 0) return 0.0;
  return setJaccardSimilarity(new Set(tokensA), new Set(tokensB));
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
  const currentSet = new Set(currentTokens);

  const toolNormalized = tool.trim().toLowerCase();
  let maxSim = 0;

  for (let i = recentActions.length - 1; i >= 0; i -= 1) {
    const prev = recentActions[i]!;
    if (prev.tool.trim().toLowerCase() === toolNormalized) {
      const prevTokens = extractArgTokens(prev.normalizedArgs);
      const sim = setJaccardSimilarity(currentSet, new Set(prevTokens));
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

export function detectActionLoop(
  tool: string,
  args: unknown,
  recentActions: BurrAction[],
  config: Partial<RuntimeConfig> = {},
): {
  blocked: boolean;
  score: number;
  level: LoopRiskLevel;
  reasons: string[];
  suggestedAction?: string;
  details?: Record<string, unknown>;
} {
  const mergedConfig: RuntimeConfig = {
    ...DEFAULT_RUNTIME_CONFIG,
    ...config,
  };
  const result = evaluateLoopRisk(tool, args, recentActions, mergedConfig);
  const blocked = result.level === "block";

  let suggestedAction: string | undefined;
  if (blocked) {
    if (result.reasons.includes("exact-repeat")) {
      suggestedAction = `Halt repeated ${tool} execution. Modify arguments or inspect environment before retrying.`;
    } else if (result.reasons.includes("cycle")) {
      suggestedAction = `Break cyclic tool pattern. Switch to a different diagnostic or build strategy.`;
    } else if (result.reasons.includes("output-stagnation")) {
      suggestedAction = `Output is stagnant with zero forward progress. Step back and re-evaluate the hypothesis.`;
    } else {
      suggestedAction = `Halt repeating execution trajectory. Pivot to an alternative approach.`;
    }
  } else if (result.level === "warn") {
    suggestedAction = `Warning: repetitive pattern detected (risk score ${result.score}/100). Consider alternative actions.`;
  }

  return {
    blocked,
    score: result.score,
    level: result.level,
    reasons: result.reasons,
    suggestedAction,
    details: result.details,
  };
}

export interface LoopDetectorOptions {
  config?: Partial<RuntimeConfig>;
  autoRecord?: boolean;
}

export class LoopDetector {
  private actions: BurrAction[] = [];
  private config: RuntimeConfig;
  private autoRecord: boolean;

  constructor(options: LoopDetectorOptions | Partial<RuntimeConfig> = {}) {
    const opts = "config" in options || "autoRecord" in options
      ? (options as LoopDetectorOptions)
      : { config: options as Partial<RuntimeConfig> };
    this.config = {
      ...DEFAULT_RUNTIME_CONFIG,
      ...opts.config,
    };
    this.autoRecord = opts.autoRecord ?? true;
  }

  evaluateAction(
    tool: string,
    args: unknown,
    options: { recentFailedVerify?: boolean; record?: boolean } = {},
  ): {
    blocked: boolean;
    score: number;
    level: LoopRiskLevel;
    reasons: string[];
    suggestedAction?: string;
    details?: Record<string, unknown>;
  } {
    const res = detectActionLoop(tool, args, this.actions, this.config);
    const shouldRecord = options.record ?? this.autoRecord;
    if (shouldRecord) {
      this.recordAction(tool, args, undefined, res.blocked ? "failed" : "completed");
    }
    return res;
  }

  recordAction(
    tool: string,
    args: unknown,
    output?: unknown,
    status: "completed" | "failed" = "completed",
  ): void {
    const inFp = fingerprintInput(tool, args);
    const outFp = output !== undefined ? fingerprintOutput(output) : undefined;
    this.actions.push({
      sessionId: "default",
      sequence: this.actions.length + 1,
      timestamp: new Date().toISOString(),
      harness: "generic",
      tool,
      normalizedArgs: args,
      inputFingerprint: inFp,
      outputFingerprint: outFp,
      status,
    });
    if (this.actions.length > 50) {
      this.actions = this.actions.slice(-50);
    }
  }

  getRecentActions(): BurrAction[] {
    return [...this.actions];
  }

  clear(): void {
    this.actions = [];
  }

  reset(): void {
    this.clear();
  }
}
