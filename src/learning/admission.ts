import { jaccardSimilarity } from "../runtime/loop-detector.js";
import { tokenize } from "../shared/tokens.js";
import type { CandidateLesson, MemoryItem } from "../shared/types.js";

const NOISE_PATTERNS = [
  /\bat \d{1,2}:\d{2}\b/i,
  /\bgot confused\b/i,
  /\btemp[\\/_\.]/i,
  /\bscratch[\\/_\.]/i,
  /\bopened \S+ and (?:got|did not|couldn't)/i,
  /\btrying again\b/i,
  /\bwill test later\b/i,
];

export interface AdmissionDecision {
  decision: "promote" | "merge" | "discard";
  reason: string;
  targetMemoryId?: string;
}

export function evaluateCandidateAdmission(
  candidate: CandidateLesson,
  existingMemories: MemoryItem[],
): AdmissionDecision {
  const text = candidate.statement.trim();

  // 1. Length check
  if (text.length < 15) {
    return { decision: "discard", reason: "statement-too-short" };
  }

  // 2. Verification requirement
  if (!candidate.evidence.verified) {
    return { decision: "discard", reason: "unverified-outcome" };
  }

  // 3. Noise / ephemeral patterns check
  for (const pattern of NOISE_PATTERNS) {
    if (pattern.test(text)) {
      return { decision: "discard", reason: "ephemeral-or-noisy-statement" };
    }
  }

  // 4. Minimum confidence check
  if (candidate.confidence < 0.65) {
    return { decision: "discard", reason: "low-confidence" };
  }

  // 5. Deduplication & Merge evaluation
  const candidateTokens = tokenize(text);
  let bestMatch: MemoryItem | null = null;
  let bestSim = 0;

  for (const existing of existingMemories) {
    // Only merge within matching scope level and matching or broader repository
    const sameScope =
      existing.scope.level === candidate.scope.level &&
      (!candidate.scope.repository || existing.scope.repository === candidate.scope.repository);

    if (sameScope) {
      const existingText = existing.statement || existing.title || "";
      const existingTokens = tokenize(existingText);
      const sim = jaccardSimilarity(candidateTokens, existingTokens);

      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = existing;
      }
    }
  }

  if (bestMatch && bestSim >= 0.65) {
    return {
      decision: "merge",
      reason: "high-similarity-with-existing",
      targetMemoryId: bestMatch.id,
    };
  }

  return {
    decision: "promote",
    reason: "verified-novel-lesson",
  };
}
