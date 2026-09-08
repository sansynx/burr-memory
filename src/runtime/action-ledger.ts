import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { clip } from "../shared/bounds.js";
import {
  assertInside,
  readInside,
  appendInside,
  writeInside,
  removeInside,
  withInsideLock,
} from "../shared/fs.js";
import { userHome } from "../shared/home.js";
import { redact, redactStructured } from "../shared/redaction.js";
import type { BurrAction, RunSummary } from "../shared/types.js";
import { ensureUserMemory, userRunsDir } from "../shared/user-memory.js";

const MAX_SESSION_ACTIONS = 500;
const MAX_CACHED_SESSIONS = 50;
const sessionMemoryCache = new Map<string, BurrAction[]>();

export function clearSessionCache(): void {
  sessionMemoryCache.clear();
}

function cacheSessionActions(sessionId: string, actions: BurrAction[]): void {
  if (
    sessionMemoryCache.size >= MAX_CACHED_SESSIONS &&
    !sessionMemoryCache.has(sessionId)
  ) {
    const oldestKey = sessionMemoryCache.keys().next().value;
    if (oldestKey) sessionMemoryCache.delete(oldestKey);
  }
  sessionMemoryCache.set(sessionId, actions);
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

export function runFilePath(home: string, sessionId: string): string {
  const safeId = sanitizeSessionId(sessionId);
  return join(userRunsDir(home), `${safeId}.jsonl`);
}

export async function recordAction(
  home: string | undefined,
  action: Omit<BurrAction, "sequence" | "timestamp"> & {
    sequence?: number;
    timestamp?: string;
  },
): Promise<BurrAction> {
  const resolvedHome = home ?? userHome();
  await ensureUserMemory(resolvedHome);

  const sessionId = action.sessionId;
  const filePath = runFilePath(resolvedHome, sessionId);
  return withInsideLock(resolvedHome, `${filePath}.lock`, async () => {
    const persisted = await readStoredActions(resolvedHome, filePath);
    const sequence =
      action.sequence ??
      (persisted.length > 0
        ? persisted[persisted.length - 1]!.sequence + 1
        : 1);
    const timestamp = action.timestamp ?? new Date().toISOString();

    const completeAction: BurrAction = {
      ...action,
      sequence,
      timestamp,
      normalizedArgs: redactStructured(action.normalizedArgs),
      error: action.error ? redact(action.error) : undefined,
      outputSnippet: action.outputSnippet
        ? clip(redact(action.outputSnippet), 1000)
        : undefined,
    };

    const line = `${JSON.stringify(completeAction)}\n`;
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

    persisted.push(completeAction);
    cacheSessionActions(filePath, persisted.slice(-MAX_SESSION_ACTIONS));
    return completeAction;
  });
}

export async function getSessionActions(
  home: string | undefined,
  sessionId: string,
): Promise<BurrAction[]> {
  const resolvedHome = home ?? userHome();
  const filePath = runFilePath(resolvedHome, sessionId);
  const cached = sessionMemoryCache.get(filePath);
  if (cached && cached.length > 0) {
    return [...cached];
  }

  const actions = await readStoredActions(resolvedHome, filePath);
  cacheSessionActions(filePath, actions.slice(-MAX_SESSION_ACTIONS));
  return actions;
}

async function readStoredActions(
  resolvedHome: string,
  filePath: string,
): Promise<BurrAction[]> {
  try {
    const raw = await readInside(resolvedHome, filePath);
    const lines = raw.split(/\r?\n/);
    const actions: BurrAction[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!.trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as BurrAction;
        if (
          parsed &&
          typeof parsed.sessionId === "string" &&
          typeof parsed.tool === "string"
        ) {
          actions.push(parsed);
        }
      } catch {
        // Skip corrupt lines
      }
    }

    return actions;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function loadRun(
  home: string | undefined,
  sessionId: string,
): Promise<RunSummary | null> {
  const resolvedHome = home ?? userHome();
  const actions = await readStoredActions(
    resolvedHome,
    runFilePath(resolvedHome, sessionId),
  );
  if (actions.length === 0) return null;

  const harness = actions[0]?.harness ?? "unknown";
  const startTime = actions[0]?.timestamp ?? new Date().toISOString();
  const endTime = actions[actions.length - 1]?.timestamp;

  const startMs = new Date(startTime).getTime();
  const endMs = endTime ? new Date(endTime).getTime() : startMs;
  const durationMs = Math.max(0, endMs - startMs);

  let failedCalls = 0;
  let blockedCalls = 0;
  let repeatedActions = 0;
  let loopsDetected = 0;
  let memorySearches = 0;
  let memoryHits = 0;
  let verified = false;

  for (const a of actions) {
    if (a.status === "failed") failedCalls += 1;
    if (a.status === "blocked") blockedCalls += 1;
    if (a.signals?.exactRepeat || a.signals?.fuzzyRepeat) repeatedActions += 1;
    if (
      a.signals?.exactRepeat ||
      a.signals?.fuzzyRepeat ||
      a.signals?.cycle ||
      a.signals?.stagnation
    ) {
      loopsDetected += 1;
    }
    if (a.tool.includes("burr-search") || a.tool === "search") {
      memorySearches += 1;
    }
    if (a.outputSnippet && a.outputSnippet.includes("HIT")) {
      memoryHits += 1;
    }
    if (
      (a.tool === "bash" || a.tool === "exec" || a.tool === "test") &&
      a.status === "completed" &&
      typeof a.normalizedArgs === "object" &&
      a.normalizedArgs !== null &&
      JSON.stringify(a.normalizedArgs).toLowerCase().includes("test")
    ) {
      verified = true;
    }
  }

  return {
    sessionId,
    harness,
    startTime,
    endTime,
    durationMs,
    toolCalls: actions.length,
    failedCalls,
    blockedCalls,
    repeatedActions,
    loopsDetected,
    memorySearches,
    memoryHits,
    verified,
    candidatesGenerated: 0,
    actions,
  };
}

export async function listRuns(home?: string): Promise<string[]> {
  const resolvedHome = home ?? userHome();
  const dir = userRunsDir(resolvedHome);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => e.name.replace(/\.jsonl$/, ""));
  } catch {
    return [];
  }
}

export async function cleanOldRuns(
  home: string | undefined,
  retentionDays = 7,
): Promise<number> {
  const resolvedHome = home ?? userHome();
  const dir = userRunsDir(resolvedHome);
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let deleted = 0;

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isFile() &&
        (entry.name.endsWith(".jsonl") || entry.name.endsWith(".hooks.json"))
      ) {
        const full = join(dir, entry.name);
        try {
          const st = await stat(full);
          if (now - st.mtimeMs > maxAgeMs) {
            await removeInside(resolvedHome, full);
            deleted += 1;
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  return deleted;
}
