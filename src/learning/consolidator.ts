import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  assertInside,
  readInside,
  writeInside,
  removeInside,
  withInsideLock,
} from "../shared/fs.js";
import { userHome } from "../shared/home.js";
import { renderPlaybook } from "../shared/playbook.js";
import { redact, redactStructured } from "../shared/redaction.js";
import type { CandidateLesson, MemoryItem } from "../shared/types.js";
import { evaluateCandidateAdmission } from "./admission.js";
import {
  scopeKey,
  validCandidate,
  validId,
  validMemory,
} from "./validation.js";
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

async function saveCandidateUnlocked(
  candidate: CandidateLesson,
  home?: string,
): Promise<void> {
  const resolvedHome = home ?? userHome();
  if (!validCandidate(candidate)) throw new Error("Invalid candidate");
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

async function listCandidatesUnlocked(
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
    const results = await readBatches(jsonFiles, async (entry) => {
      try {
        const raw = await readInside(resolvedHome, join(dir, entry.name));
        const parsed = JSON.parse(raw) as CandidateLesson;
        return validCandidate(parsed) && `${parsed.id}.json` === entry.name
          ? parsed
          : null;
      } catch {
        return null;
      }
    });
    return results.filter((c): c is CandidateLesson => c !== null);
  } catch {
    return [];
  }
}

async function deleteCandidateUnlocked(
  candidateId: string,
  home?: string,
): Promise<void> {
  if (!validId(candidateId)) throw new Error("Invalid candidate id");
  const resolvedHome = home ?? userHome();
  const dir = userCandidatesDir(resolvedHome);
  const filePath = join(dir, `${candidateId}.json`);
  assertInside(dir, filePath);
  try {
    assertInside(resolvedHome, filePath);
    await removeInside(resolvedHome, filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function saveMemoryItemUnlocked(
  item: MemoryItem,
  home?: string,
): Promise<void> {
  const resolvedHome = home ?? userHome();
  if (!validMemory(item)) throw new Error("Invalid memory");
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
  const previousDir =
    item.status === "archived"
      ? memoryDirForType(item.type, resolvedHome)
      : userArchiveDir(resolvedHome);
  await removeIfPresent(resolvedHome, join(previousDir, `${item.id}.json`));
  if (item.status === "archived" && item.type === "playbook") {
    await removeIfPresent(
      resolvedHome,
      join(userPlaybooksDir(resolvedHome), `${item.id}.md`),
    );
  }
}

async function promoteCandidateUnlocked(
  candidate: CandidateLesson,
  home?: string,
): Promise<MemoryItem> {
  const resolvedHome = home ?? userHome();
  await ensureUserMemory(resolvedHome);

  if (!validCandidate(candidate)) throw new Error("Invalid candidate");
  let memoryType: MemoryItem["type"] = "knowledge";
  if (candidate.type === "tool-strategy") {
    memoryType = "tool-strategy";
  } else if (candidate.type === "playbook") {
    memoryType = "playbook";
  }

  const id = `mem-${candidate.id.replace(/^cand-/, "")}`;
  const prior = await getMemoryUnlocked(id, resolvedHome);
  if (prior) return mergeCandidateUnlocked(candidate, id, resolvedHome);
  const now = new Date().toISOString();

  const item: MemoryItem & { appliedCandidates: string[] } = {
    appliedCandidates: [candidateReceipt(candidate)],
    id,
    title: candidate.statement.slice(0, 70),
    type: memoryType,
    statement: candidate.statement,
    ...(candidate.playbook
      ? {
          problem: candidate.playbook.problem,
          rootCause: candidate.playbook.rootCause,
          fix: candidate.playbook.fix,
          verification: candidate.playbook.verification,
        }
      : {}),
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

  await saveMemoryItemUnlocked(item, resolvedHome);
  await syncPlaybook(item, candidate, resolvedHome);
  await deleteCandidateUnlocked(candidate.id, resolvedHome);

  return item;
}

async function mergeCandidateUnlocked(
  candidate: CandidateLesson,
  targetMemoryId: string,
  home?: string,
): Promise<MemoryItem> {
  const resolvedHome = home ?? userHome();
  if (!validCandidate(candidate)) throw new Error("Invalid candidate");
  const existing = await getMemoryUnlocked(targetMemoryId, resolvedHome);

  if (!existing) {
    return promoteCandidateUnlocked(candidate, resolvedHome);
  }

  if (scopeKey(existing.scope) !== scopeKey(candidate.scope))
    throw new Error("Cannot merge different memory scopes");
  const receipts =
    (existing as MemoryItem & { appliedCandidates?: string[] })
      .appliedCandidates ?? [];
  const receipt = candidateReceipt(candidate);
  if (receipts.includes(receipt)) {
    if (existing.status !== "archived")
      await syncPlaybook(existing, candidate, resolvedHome);
    await deleteCandidateUnlocked(candidate.id, resolvedHome);
    return existing;
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

  const updated: MemoryItem & { appliedCandidates: string[] } = {
    ...existing,
    ...(candidate.playbook
      ? {
          problem: candidate.playbook.problem,
          rootCause: candidate.playbook.rootCause,
          fix: candidate.playbook.fix,
          verification: candidate.playbook.verification,
        }
      : {}),
    status: "active",
    appliedCandidates: [...receipts, receipt],
    statement:
      (existing.statement || existing.title) === candidate.statement
        ? candidate.statement
        : `${existing.statement || existing.title} | ${candidate.statement}`,
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

  await saveMemoryItemUnlocked(updated, resolvedHome);
  if (existing.status === "archived")
    await removeIfPresent(
      resolvedHome,
      join(userArchiveDir(resolvedHome), `${existing.id}.json`),
    );
  await syncPlaybook(updated, candidate, resolvedHome);
  await deleteCandidateUnlocked(candidate.id, resolvedHome);
  return updated;
}

async function getMemoryUnlocked(
  id: string,
  home?: string,
): Promise<MemoryItem | null> {
  if (!validId(id)) return null;
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
      const item: unknown = JSON.parse(raw);
      if (validMemory(item) && item.id === id) return item;
    } catch {
      // try next
    }
  }

  return null;
}

async function listAllMemoriesUnlocked(home?: string): Promise<MemoryItem[]> {
  const resolvedHome = home ?? userHome();
  await ensureUserMemory(resolvedHome);

  const dirs = [
    userKnowledgeDir(resolvedHome),
    userToolStrategiesDir(resolvedHome),
    userArchiveDir(resolvedHome),
  ];

  const dirResults = [];
  for (const dir of dirs) {
    dirResults.push(
      await (async () => {
        try {
          const entries = await readdir(dir, { withFileTypes: true });
          const jsonFiles = entries.filter(
            (e) => e.isFile() && e.name.endsWith(".json"),
          );
          const parsed = await readBatches(jsonFiles, async (entry) => {
            try {
              const raw = await readInside(resolvedHome, join(dir, entry.name));
              const item = JSON.parse(raw) as MemoryItem;
              return validMemory(item) && `${item.id}.json` === entry.name
                ? item
                : null;
            } catch {
              return null;
            }
          });
          return parsed.filter((m): m is MemoryItem => m !== null);
        } catch {
          return [];
        }
      })(),
    );
  }

  return dirResults.flat();
}

async function recordMemoryReuseUnlocked(
  memoryId: string,
  success: boolean,
  home?: string,
): Promise<MemoryItem | null> {
  const resolvedHome = home ?? userHome();
  const existing = await getMemoryUnlocked(memoryId, resolvedHome);
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

  await saveMemoryItemUnlocked(updated, resolvedHome);
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

async function applyMemoryDecayAndPruningUnlocked(
  home?: string,
  archiveDays = 60,
): Promise<{ staled: number; archived: number; pruned: number }> {
  const resolvedHome = home ?? userHome();
  if (!Number.isFinite(archiveDays) || archiveDays <= 0)
    throw new Error("Invalid archive age");
  const memories = await listAllMemoriesUnlocked(resolvedHome);
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
        await saveMemoryItemUnlocked(item, resolvedHome);
        await removeIfPresent(resolvedHome, oldFile);
        if (item.type === "playbook")
          await removeIfPresent(
            resolvedHome,
            join(userPlaybooksDir(resolvedHome), `${item.id}.md`),
          );
        archived += 1;
      } else if (
        item.status === "active" &&
        (daysSinceUsed > archiveDays / 2 || score < 5)
      ) {
        item.status = "stale";
        item.updatedAt = new Date().toISOString();
        await saveMemoryItemUnlocked(item, resolvedHome);
        staled += 1;
      }
    } else if (item.status === "archived") {
      if (item.type === "playbook")
        await removeIfPresent(
          resolvedHome,
          join(userPlaybooksDir(resolvedHome), `${item.id}.md`),
        );
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

async function consolidateMemoriesUnlocked(
  home?: string,
): Promise<{ promoted: number; merged: number; discarded: number }> {
  const resolvedHome = home ?? userHome();
  const candidates = await listCandidatesUnlocked(resolvedHome);
  const existing = await listAllMemoriesUnlocked(resolvedHome);

  let promoted = 0;
  let merged = 0;
  let discarded = 0;

  for (const candidate of candidates) {
    const decision = evaluateCandidateAdmission(candidate, existing);
    if (decision.decision === "promote") {
      const item = await promoteCandidateUnlocked(candidate, resolvedHome);
      existing.push(item);
      promoted += 1;
    } else if (decision.decision === "merge" && decision.targetMemoryId) {
      const item = await mergeCandidateUnlocked(
        candidate,
        decision.targetMemoryId,
        resolvedHome,
      );
      const index = existing.findIndex((memory) => memory.id === item.id);
      if (index !== -1) existing[index] = item;
      merged += 1;
    } else {
      await deleteCandidateUnlocked(candidate.id, resolvedHome);
      discarded += 1;
    }
  }

  return { promoted, merged, discarded };
}

async function trimCandidatesUnlocked(
  home?: string,
  maxCandidates = 100,
): Promise<number> {
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1)
    throw new Error("Invalid candidate limit");
  const candidates = await listCandidatesUnlocked(home);
  candidates.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );
  const expired = candidates.slice(maxCandidates);
  for (const candidate of expired)
    await deleteCandidateUnlocked(candidate.id, home);
  return expired.length;
}

function candidateReceipt(candidate: CandidateLesson): string {
  return createHash("sha256")
    .update(JSON.stringify([candidate.id, candidate.evidence.sessionId]))
    .digest("hex");
}

async function syncPlaybook(
  item: MemoryItem,
  candidate: CandidateLesson,
  home: string,
): Promise<void> {
  if (item.type !== "playbook") return;
  await writeInside(
    home,
    join(userPlaybooksDir(home), `${item.id}.md`),
    renderPlaybook({
      title: redact(item.title),
      signature: item.id,
      error: redact(item.problem || item.statement || item.title),
      rootCause: redact(item.rootCause || "Observed and learned by Burr"),
      fix: redact(item.fix || item.statement || item.title),
      verification: redact(
        [
          item.verification?.command || candidate.evidence.verificationCommand,
          item.verification?.result,
        ]
          .filter(Boolean)
          .join("\n") || "verified",
      ),
    }),
  );
}

async function removeIfPresent(home: string, path: string): Promise<void> {
  try {
    await removeInside(home, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function withLearningLock<T>(
  home: string | undefined,
  action: (root: string) => Promise<T>,
): Promise<T> {
  const root = home ?? userHome();
  await ensureUserMemory(root);
  return withInsideLock(root, join(root, ".burr", "learning.lock"), () =>
    action(root),
  );
}

export const saveCandidate = (
  candidate: CandidateLesson,
  home?: string,
): Promise<void> =>
  withLearningLock(home, (root) => saveCandidateUnlocked(candidate, root));
export const deleteCandidate = (id: string, home?: string): Promise<void> =>
  withLearningLock(home, (root) => deleteCandidateUnlocked(id, root));
export const saveMemoryItem = (
  item: MemoryItem,
  home?: string,
): Promise<void> =>
  withLearningLock(home, (root) => saveMemoryItemUnlocked(item, root));
export const promoteCandidate = (
  candidate: CandidateLesson,
  home?: string,
): Promise<MemoryItem> =>
  withLearningLock(home, (root) => promoteCandidateUnlocked(candidate, root));
export const mergeCandidate = (
  candidate: CandidateLesson,
  id: string,
  home?: string,
): Promise<MemoryItem> =>
  withLearningLock(home, (root) => mergeCandidateUnlocked(candidate, id, root));
export const recordMemoryReuse = (
  id: string,
  success: boolean,
  home?: string,
): Promise<MemoryItem | null> =>
  withLearningLock(home, (root) =>
    recordMemoryReuseUnlocked(id, success, root),
  );
export const applyMemoryDecayAndPruning = (
  home?: string,
  archiveDays = 60,
): Promise<{ staled: number; archived: number; pruned: number }> =>
  withLearningLock(home, (root) =>
    applyMemoryDecayAndPruningUnlocked(root, archiveDays),
  );
export const consolidateMemories = (
  home?: string,
): Promise<{ promoted: number; merged: number; discarded: number }> =>
  withLearningLock(home, (root) => consolidateMemoriesUnlocked(root));
export const trimCandidates = (
  home?: string,
  maxCandidates = 100,
): Promise<number> =>
  withLearningLock(home, (root) => trimCandidatesUnlocked(root, maxCandidates));

export const listCandidates = (home?: string): Promise<CandidateLesson[]> =>
  withLearningLock(home, (root) => listCandidatesUnlocked(root));
export const listAllMemories = (home?: string): Promise<MemoryItem[]> =>
  withLearningLock(home, (root) => listAllMemoriesUnlocked(root));
export const getMemory = (
  id: string,
  home?: string,
): Promise<MemoryItem | null> =>
  withLearningLock(home, (root) => getMemoryUnlocked(id, root));

async function readBatches<T, R>(
  items: T[],
  read: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += 32) {
    results.push(
      ...(await Promise.all(items.slice(offset, offset + 32).map(read))),
    );
  }
  return results;
}
