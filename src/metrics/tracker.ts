import { listCandidates, listAllMemories } from "../learning/consolidator.js";
import { listRuns, loadRun } from "../runtime/action-ledger.js";
import {
  assertInside,
  appendInside,
  readInside,
  writeInside,
} from "../shared/fs.js";
import { userHome } from "../shared/home.js";
import { redactStructured } from "../shared/redaction.js";
import type { BurrStats, MetricsEvent } from "../shared/types.js";
import {
  ensureUserMemory,
  userMetricsEventsPath,
} from "../shared/user-memory.js";

export async function recordMetricsEvent(
  event: Omit<MetricsEvent, "ts"> & { ts?: string },
  home?: string,
): Promise<MetricsEvent> {
  const resolvedHome = home ?? userHome();
  await ensureUserMemory(resolvedHome);

  const fullEvent: MetricsEvent = {
    ...redactStructured(event),
    ts: event.ts ?? new Date().toISOString(),
  };

  const filePath = userMetricsEventsPath(resolvedHome);
  const line = `${JSON.stringify(fullEvent)}\n`;

  try {
    assertInside(resolvedHome, filePath);
    await appendInside(resolvedHome, filePath, line);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await writeInside(resolvedHome, filePath, line);
    } else {
      throw error;
    }
  }

  return fullEvent;
}

export async function loadAllEvents(home?: string): Promise<MetricsEvent[]> {
  const resolvedHome = home ?? userHome();
  const filePath = userMetricsEventsPath(resolvedHome);

  try {
    const raw = await readInside(resolvedHome, filePath);
    const lines = raw.split(/\r?\n/);
    const events: MetricsEvent[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!.trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as MetricsEvent;
        if (parsed && parsed.ts && parsed.type) {
          events.push(parsed);
        }
      } catch {
        // skip corrupt lines
      }
    }

    return events;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function computeBurrStats(home?: string): Promise<BurrStats> {
  const resolvedHome = home ?? userHome();
  const [events, memories, candidates, runIds] = await Promise.all([
    loadAllEvents(resolvedHome),
    listAllMemories(resolvedHome),
    listCandidates(resolvedHome),
    listRuns(resolvedHome),
  ]);

  let activeCount = 0;
  let archivedCount = 0;
  let successfulReuseCount = 0;
  let failedReuseCount = 0;

  for (const m of memories) {
    if (m.status === "archived") {
      archivedCount += 1;
    } else {
      activeCount += 1;
    }
    successfulReuseCount += m.evidence.successfulReuse;
    failedReuseCount += m.evidence.failedReuse;
  }

  let searches = 0;
  let hits = 0;
  let misses = 0;
  let candidateCreated = 0;
  let candidateDiscarded = 0;
  let memoryMerged = 0;
  let memoryPromoted = 0;
  let actionsBlocked = 0;
  let verifiedRecoveries = 0;

  const loopCounts = {
    total: 0,
    exact: 0,
    fuzzy: 0,
    cycles: 0,
    stagnation: 0,
  };

  const sessions = new Set<string>();
  let totalCalls = 0;

  for (const ev of events) {
    if (ev.sessionId) sessions.add(ev.sessionId);

    switch (ev.type) {
      case "search":
        searches += 1;
        break;
      case "hit":
        hits += 1;
        break;
      case "miss":
        misses += 1;
        break;
      case "tool_call":
        totalCalls += 1;
        break;
      case "action_blocked":
        actionsBlocked += 1;
        break;
      case "candidate_created":
        candidateCreated += 1;
        break;
      case "candidate_discarded":
        candidateDiscarded += 1;
        break;
      case "memory_merged":
        memoryMerged += 1;
        break;
      case "memory_promoted":
        memoryPromoted += 1;
        break;
      case "verification":
        if (ev.data?.verified) verifiedRecoveries += 1;
        break;
      case "loop_detected":
        loopCounts.total += 1;
        const reasons = (ev.data?.reasons as string[]) || [];
        if (reasons.includes("exact-repeat")) loopCounts.exact += 1;
        if (reasons.includes("fuzzy-repeat")) loopCounts.fuzzy += 1;
        if (reasons.includes("cycle")) loopCounts.cycles += 1;
        if (reasons.includes("output-stagnation")) loopCounts.stagnation += 1;
        break;
    }
  }

  // Also include session runs if totalCalls is 0
  if (totalCalls === 0 && runIds.length > 0) {
    for (const rId of runIds) {
      sessions.add(rId);
    }
  }

  const totalSearches = hits + misses;
  const hitRate =
    totalSearches > 0 ? Math.round((hits / totalSearches) * 100) : 0;

  return {
    memory: {
      active: activeCount,
      candidates: candidates.length,
      archived: archivedCount,
      hitRate,
      searches: Math.max(searches, totalSearches),
      hits,
      misses,
    },
    learning: {
      reusedTotal: successfulReuseCount + failedReuseCount,
      successfulReuse: successfulReuseCount,
      failedReuse: failedReuseCount,
      merged: memoryMerged,
      promoted: memoryPromoted,
      discarded: candidateDiscarded,
    },
    runtime: {
      observedSessions: sessions.size,
      observedCalls: totalCalls,
      loopsDetected: loopCounts,
      actionsBlocked,
      verifiedRecoveries,
    },
  };
}

export interface LearningProgressionStep {
  sessionId: string;
  sequence: number;
  toolCalls: number;
  failedCalls: number;
  loops: number;
  memoryHits: number;
  durationMs: number;
  verified: boolean;
}

export async function computeLearningProgression(
  home?: string,
): Promise<LearningProgressionStep[]> {
  const resolvedHome = home ?? userHome();
  const runIds = await listRuns(resolvedHome);
  const summaries = await Promise.all(
    runIds.map((id) => loadRun(resolvedHome, id)),
  );
  const steps: LearningProgressionStep[] = [];

  for (let i = 0; i < summaries.length; i += 1) {
    const summary = summaries[i];
    if (summary) {
      steps.push({
        sessionId: summary.sessionId,
        sequence: i + 1,
        toolCalls: summary.toolCalls,
        failedCalls: summary.failedCalls,
        loops: summary.loopsDetected,
        memoryHits: summary.memoryHits,
        durationMs: summary.durationMs,
        verified: summary.verified,
      });
    }
  }

  return steps;
}
