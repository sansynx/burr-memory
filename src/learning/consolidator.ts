import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  assertInside,
  readInside,
  writeInside,
  removeInside,
} from "../shared/fs.js";
import { userHome } from "../shared/home.js";
import { renderPlaybook } from "../shared/playbook.js";
import { redact, redactStructured } from "../shared/redaction.js";
import type { CandidateLesson, MemoryItem } from "../shared/types.js";
import { evaluateCandidateAdmission } from "./admission.js";
import {
  ensureUserMemory,
  userArchiveDir,
  userCandidatesDir,
  userKnowledgeDir,
  userPlaybooksDir,
  userToolStrategiesDir,
} from "../shared/user-memory.js";

function memoryDirForType(type: MemoryItem["type"], home: string): string {
  switch (type) {
    case "tool-strategy":
      return userToolStrategiesDir(home);
    case "knowledge":
    case "playbook":
    default:
      return userKnowledgeDir(home);
  }
}

export async function saveCandidate(
  candidate: CandidateLesson,
  home?: string,
): Promise<void> {
  const resolvedHome = home ?? userHome();
  await ensureUserMemory(resolvedHome);
  const dir = userCandidatesDir(resolvedHome);
  const filePath = join(dir, `${candidate.id}.json`);
  assertInside(dir, filePath);
  assertInside(resolvedHome, filePath);
  await writeInside(
    resolvedHome,
    filePath,
    `${JSON.stringify(redactStructured(candidate), null, 2)}\n`,
  );
}

export async function listCandidates(
  home?: string,
): Promise<CandidateLesson[]> {
  const resolvedHome = home ?? userHome();
  await ensureUserMemory(resolvedHome);
  const dir = userCandidatesDir(resolvedHome);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const jsonFiles = entries.filter(
      (e) => e.isFile() && e.name.endsWith(".json"),
    );
    const results = await Promise.all(
      jsonFiles.map(async (entry) => {
        try {
          const raw = await readInside(resolvedHome, join(dir, entry.name));
          const parsed = JSON.parse(raw) as CandidateLesson;
          return parsed && parsed.id && parsed.statement ? parsed : null;
        } catch {
          return null;
        }
      }),
    );
    return results.filter((c): c is CandidateLesson => c !== null);
  } catch {
    return [];
  }
}

export async function deleteCandidate(
  candidateId: string,
  home?: string,
): Promise<void> {
  const resolvedHome = home ?? userHome();
  const dir = userCandidatesDir(resolvedHome);
  const filePath = join(dir, `${candidateId}.json`);
  assertInside(dir, filePath);
  try {
    assertInside(resolvedHome, filePath);
    await removeInside(resolvedHome, filePath);
  } catch {
    // ignore
  }
}

export async function saveMemoryItem(
  item: MemoryItem,
  home?: string,
): Promise<void> {
  const resolvedHome = home ?? userHome();
  await ensureUserMemory(resolvedHome);

  const dir =
    item.status === "archived"
      ? userArchiveDir(resolvedHome)
      : memoryDirForType(item.type, resolvedHome);
  const filePath = join(dir, `${item.id}.json`);
  assertInside(dir, filePath);
  assertInside(resolvedHome, filePath);
  await writeInside(
    resolvedHome,
    filePath,
    `${JSON.stringify(redactStructured(item), null, 2)}\n`,
  );
}

export async function promoteCandidate(
  candidate: CandidateLesson,
  home?: string,
): Promise<MemoryItem> {
  const resolvedHome = home ?? userHome();
  await ensureUserMemory(resolvedHome);

  let memoryType: MemoryItem["type"] = "knowledge";
  if (candidate.type === "tool-strategy") {
    memoryType = "tool-strategy";
  } else if (candidate.type === "playbook") {
    memoryType = "playbook";
  }

  const id = `mem-${candidate.id.replace(/^cand-/, "")}`;
  const now = new Date().toISOString();

  const item: MemoryItem = {
    id,
    title: candidate.statement.slice(0, 70),
    type: memoryType,
    statement: candidate.statement,
    scope: candidate.scope,
    evidence: {
      observed: candidate.evidence.observedCount || 1,
      successfulReuse: 0,
      failedReuse: 0,
      lastUsed: now,
      sessionIds: [candidate.evidence.sessionId],
    },
    confidence: candidate.confidence,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  await saveMemoryItem(item, resolvedHome);
  await deleteCandidate(candidate.id, resolvedHome);

  // If candidate is a playbook, also save standard playbook markdown
  if (candidate.type === "playbook") {
    const playbookFile = join(userPlaybooksDir(resolvedHome), `${id}.md`);
    try {
      await writeInside(
        resolvedHome,
        playbookFile,
        renderPlaybook({
          title: redact(item.title),
          signature: id,
          error: redact(candidate.statement),
          rootCause: "Observed and learned by Burr",
          fix: redact(candidate.statement),
          verification: redact(
            candidate.evidence.verificationCommand || "verified",
          ),
        }),
      );
    } catch {
      // ignore
    }
  }

  return item;
}

export async function mergeCandidate(
  candidate: CandidateLesson,
  targetMemoryId: string,
  home?: string,
): Promise<MemoryItem> {
  const resolvedHome = home ?? userHome();
  const existing = await getMemory(targetMemoryId, resolvedHome);

  if (!existing) {
    return promoteCandidate(candidate, resolvedHome);
  }

  const now = new Date().toISOString();
  const updatedSessions = existing.evidence.sessionIds
    ? [...existing.evidence.sessionIds]
    : [];
  if (!updatedSessions.includes(candidate.evidence.sessionId)) {
    updatedSessions.push(candidate.evidence.sessionId);
  }

  const newConfidence = Math.min(
    0.99,
    Number((existing.confidence + 0.05).toFixed(2)),
  );

  const updated: MemoryItem = {
    ...existing,
    statement: `${existing.statement} | ${candidate.statement}`,
    evidence: {
      ...existing.evidence,
      observed:
        existing.evidence.observed + (candidate.evidence.observedCount || 1),
      lastUsed: now,
      sessionIds: updatedSessions,
    },
    confidence: newConfidence,
    updatedAt: now,
  };

  await saveMemoryItem(updated, resolvedHome);
  await deleteCandidate(candidate.id, resolvedHome);
  return updated;
}

export async function getMemory(
  id: string,
  home?: string,
): Promise<MemoryItem | null> {
  const resolvedHome = home ?? userHome();
  const dirs = [
    userKnowledgeDir(resolvedHome),
    userToolStrategiesDir(resolvedHome),
    userArchiveDir(resolvedHome),
  ];

  for (const dir of dirs) {
    const filePath = join(dir, `${id}.json`);
    try {
      const raw = await readInside(resolvedHome, filePath);
      return JSON.parse(raw) as MemoryItem;
    } catch {
      // try next
    }
  }

  return null;
}

export async function listAllMemories(home?: string): Promise<MemoryItem[]> {
  const resolvedHome = home ?? userHome();
  await ensureUserMemory(resolvedHome);

  const dirs = [
    userKnowledgeDir(resolvedHome),
    userToolStrategiesDir(resolvedHome),
    userArchiveDir(resolvedHome),
  ];

  const dirResults = await Promise.all(
    dirs.map(async (dir) => {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        const jsonFiles = entries.filter(
          (e) => e.isFile() && e.name.endsWith(".json"),
        );
        const parsed = await Promise.all(
          jsonFiles.map(async (entry) => {
            try {
              const raw = await readInside(resolvedHome, join(dir, entry.name));
              const item = JSON.parse(raw) as MemoryItem;
              return item && item.id ? item : null;
            } catch {
              return null;
            }
          }),
        );
        return parsed.filter((m): m is MemoryItem => m !== null);
      } catch {
        return [];
      }
    }),
  );

  return dirResults.flat();
}

export async function recordMemoryReuse(
  memoryId: string,
  success: boolean,
  home?: string,
): Promise<MemoryItem | null> {
  const resolvedHome = home ?? userHome();
  const existing = await getMemory(memoryId, resolvedHome);
  if (!existing) return null;

  const now = new Date().toISOString();
  let nextConfidence = existing.confidence;

  if (success) {
    nextConfidence = Math.min(
      0.99,
      Number((existing.confidence + 0.05).toFixed(2)),
    );
  } else {
    nextConfidence = Math.max(
      0.1,
      Number((existing.confidence - 0.15).toFixed(2)),
    );
  }

  const updated: MemoryItem = {
    ...existing,
    evidence: {
      ...existing.evidence,
      successfulReuse: existing.evidence.successfulReuse + (success ? 1 : 0),
      failedReuse: existing.evidence.failedReuse + (success ? 0 : 1),
      lastUsed: now,
    },
    confidence: nextConfidence,
    updatedAt: now,
  };

  await saveMemoryItem(updated, resolvedHome);
  return updated;
}

export function calculateMemoryScore(
  item: MemoryItem,
  now = Date.now(),
): number {
  const lastUsedMs = item.evidence.lastUsed
    ? new Date(item.evidence.lastUsed).getTime()
    : now;
  const daysSinceUsed = Math.max(0, (now - lastUsedMs) / (24 * 60 * 60 * 1000));

  const base =
    item.evidence.successfulReuse * 3 +
    item.evidence.observed * 0.5 +
    item.confidence * 10;

  const penalty = item.evidence.failedReuse * 4 + daysSinceUsed * 0.1;

  return Math.max(0, Number((base - penalty).toFixed(2)));
}

export async function applyMemoryDecayAndPruning(
  home?: string,
  archiveDays = 60,
): Promise<{ staled: number; archived: number; pruned: number }> {
  const resolvedHome = home ?? userHome();
  const memories = await listAllMemories(resolvedHome);
  const now = Date.now();

  let staled = 0;
  let archived = 0;
  let pruned = 0;

  for (const item of memories) {
    const lastUsedMs = item.evidence.lastUsed
      ? new Date(item.evidence.lastUsed).getTime()
      : now;
    const daysSinceUsed = (now - lastUsedMs) / (24 * 60 * 60 * 1000);
    const score = calculateMemoryScore(item, now);

    if (item.status === "active" || item.status === "stale") {
      if (daysSinceUsed > archiveDays || score < 2) {
        // Move to archived
        const oldFile = join(
          memoryDirForType(item.type, resolvedHome),
          `${item.id}.json`,
        );
        assertInside(memoryDirForType(item.type, resolvedHome), oldFile);
        item.status = "archived";
        item.updatedAt = new Date().toISOString();
        await saveMemoryItem(item, resolvedHome);
        await removeInside(resolvedHome, oldFile);
        archived += 1;
      } else if (
        item.status === "active" &&
        (daysSinceUsed > archiveDays / 2 || score < 5)
      ) {
        item.status = "stale";
        item.updatedAt = new Date().toISOString();
        await saveMemoryItem(item, resolvedHome);
        staled += 1;
      }
    } else if (item.status === "archived") {
      // If archived and extremely old with low score and no recent reuse, eligible for deletion
      if (daysSinceUsed > archiveDays * 2 && score < 1) {
        const archiveFile = join(
          userArchiveDir(resolvedHome),
          `${item.id}.json`,
        );
        assertInside(userArchiveDir(resolvedHome), archiveFile);
        try {
          await removeInside(resolvedHome, archiveFile);
          pruned += 1;
        } catch {
          // ignore
        }
      }
    }
  }

  return { staled, archived, pruned };
}

export async function consolidateMemories(
  home?: string,
): Promise<{ promoted: number; merged: number; discarded: number }> {
  const resolvedHome = home ?? userHome();
  const candidates = await listCandidates(resolvedHome);
  const existing = await listAllMemories(resolvedHome);

  let promoted = 0;
  let merged = 0;
  let discarded = 0;

  for (const candidate of candidates) {
    const decision = evaluateCandidateAdmission(candidate, existing);
    if (decision.decision === "promote") {
      const item = await promoteCandidate(candidate, resolvedHome);
      existing.push(item);
      promoted += 1;
    } else if (decision.decision === "merge" && decision.targetMemoryId) {
      await mergeCandidate(candidate, decision.targetMemoryId, resolvedHome);
      merged += 1;
    } else {
      await deleteCandidate(candidate.id, resolvedHome);
      discarded += 1;
    }
  }

  return { promoted, merged, discarded };
}

export async function trimCandidates(
  home?: string,
  maxCandidates = 100,
): Promise<number> {
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1)
    throw new Error("Invalid candidate limit");
  const candidates = await listCandidates(home);
  candidates.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );
  const expired = candidates.slice(maxCandidates);
  for (const candidate of expired) await deleteCandidate(candidate.id, home);
  return expired.length;
}
