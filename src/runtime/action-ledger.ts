import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { clip } from "../shared/bounds.js";
import {
  assertInside,
  readInside,
  appendInside,
  writeInside,
  removeInside,
  withInsideLock,
  fileStampInside,
} from "../shared/fs.js";
import { userHome } from "../shared/home.js";
import { redact, redactStructured } from "../shared/redaction.js";
import type { BurrAction, RunSummary } from "../shared/types.js";
import { ensureUserMemory, userRunsDir } from "../shared/user-memory.js";

const MAX_SESSION_ACTIONS = 500;
const MAX_CACHED_SESSIONS = 50;
const sessionMemoryCache = new Map<
  string,
  { actions: BurrAction[]; stamp: string }
>();

export function clearSessionCache(): void {
  sessionMemoryCache.clear();
}

function cacheSessionActions(
  sessionId: string,
  actions: BurrAction[],
  stamp: string,
): void {
  if (
    sessionMemoryCache.size >= MAX_CACHED_SESSIONS &&
    !sessionMemoryCache.has(sessionId)
  ) {
    const oldestKey = sessionMemoryCache.keys().next().value;
    if (oldestKey) sessionMemoryCache.delete(oldestKey);
  }
  sessionMemoryCache.set(sessionId, { actions, stamp });
}

function sanitizeSessionId(sessionId: string): string {
  if (!sessionId.trim()) throw new Error("Session id must not be empty");
  if (
    /^[a-zA-Z0-9_-]{1,80}$/.test(sessionId) &&
    !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(sessionId)
  )
    return sessionId;
  return `session-${createHash("sha256").update(sessionId).digest("hex")}`;
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
    const persisted = await readSessionHistory(resolvedHome, sessionId);
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
    if (!validAction(completeAction)) throw new Error("Invalid action record");

    let raw = "";
    try {
      raw = await readInside(resolvedHome, filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const migrated =
      !raw && persisted.length
        ? persisted.map((entry) => JSON.stringify(entry)).join("\n") + "\n"
        : "";
    const line = `${migrated}${raw && !raw.endsWith("\n") ? "\n" : ""}${JSON.stringify(completeAction)}\n`;
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
    sessionMemoryCache.delete(filePath);
    return completeAction;
  });
}

export async function getSessionActions(
  home: string | undefined,
  sessionId: string,
): Promise<BurrAction[]> {
  const resolvedHome = home ?? userHome();
  const filePath = runFilePath(resolvedHome, sessionId);
  const stamp = await fileStampInside(resolvedHome, filePath).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  const cached = sessionMemoryCache.get(filePath);
  if (cached) {
    if (stamp && cached.stamp === stamp) return structuredClone(cached.actions);
  }

  const actions = await readSessionHistory(resolvedHome, sessionId);
  if (stamp && stamp === (await fileStampInside(resolvedHome, filePath)))
    cacheSessionActions(filePath, actions.slice(-MAX_SESSION_ACTIONS), stamp);
  return structuredClone(actions.slice(-MAX_SESSION_ACTIONS));
}

function validAction(value: unknown): value is BurrAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  if (
    typeof action.sessionId !== "string" ||
    !action.sessionId.trim() ||
    typeof action.tool !== "string" ||
    typeof action.harness !== "string" ||
    typeof action.inputFingerprint !== "string" ||
    !Number.isSafeInteger(action.sequence) ||
    Number(action.sequence) < 1 ||
    typeof action.timestamp !== "string" ||
    !Number.isFinite(Date.parse(action.timestamp)) ||
    !["started", "completed", "failed", "blocked"].includes(
      String(action.status),
    )
  )
    return false;
  if (
    !["error", "outputSnippet", "outputFingerprint"].every(
      (key) => action[key] === undefined || typeof action[key] === "string",
    )
  )
    return false;
  if (
    !["durationMs", "progressDelta"].every(
      (key) =>
        action[key] === undefined ||
        (typeof action[key] === "number" && Number.isFinite(action[key])),
    )
  )
    return false;
  if (action.signals !== undefined) {
    if (
      !action.signals ||
      typeof action.signals !== "object" ||
      Array.isArray(action.signals)
    )
      return false;
    const signals = action.signals as Record<string, unknown>;
    if (
      !["exactRepeat", "fuzzyRepeat", "cycle", "stagnation"].every(
        (key) =>
          signals[key] === undefined || typeof signals[key] === "boolean",
      )
    )
      return false;
  }
  return true;
}

async function readSessionHistory(
  home: string,
  sessionId: string,
): Promise<BurrAction[]> {
  const current = runFilePath(home, sessionId);
  const actions = await readStoredActions(home, current);
  if (actions.length)
    return actions.filter((action) => action.sessionId === sessionId);
  const legacyId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  if (!legacyId || legacyId === sanitizeSessionId(sessionId)) return [];
  return (
    await readStoredActions(home, join(userRunsDir(home), `${legacyId}.jsonl`))
  ).filter((action) => action.sessionId === sessionId);
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
        if (validAction(parsed)) {
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
  const actions = await readSessionHistory(resolvedHome, sessionId);
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
      /^(?:(?:npm|pnpm|yarn) (?:run )?test(?:\s|$)|(?:pytest|vitest|jest|cargo test|go test)(?:\s|$))/.test(
        String(
          (a.normalizedArgs as Record<string, unknown>).cmd ??
            (a.normalizedArgs as Record<string, unknown>).command ??
            "",
        ).trim(),
      )
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
    const runs = new Map<string, string>();
    for (const entry of entries.filter(
      (e) => e.isFile() && e.name.endsWith(".jsonl"),
    )) {
      const actions = await readStoredActions(
        resolvedHome,
        join(dir, entry.name),
      );
      for (const action of actions) {
        const previous = runs.get(action.sessionId);
        if (!previous || Date.parse(action.timestamp) > Date.parse(previous))
          runs.set(action.sessionId, action.timestamp);
      }
    }
    return [...runs]
      .sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]))
      .map(([id]) => id);
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
