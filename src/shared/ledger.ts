import { join } from "node:path";
import { appendInside, readInside, withInsideLock, writeInside } from "./fs.js";
import type { UsageEvent, UsageSummary, Verb } from "./types.js";

const VERBS: Verb[] = ["search", "hit", "miss", "capture", "resolve", "promote", "discard"];
const VERB_SET = new Set<string>(VERBS);

function usagePath(root: string): string {
  return join(root, ".burr", "usage.jsonl");
}

function parseLine(line: string): UsageEvent | null {
  try {
    const parsed = JSON.parse(line) as UsageEvent;
    if (!parsed || typeof parsed.ts !== "string" || !VERB_SET.has(parsed.verb)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function readUsage(root: string): Promise<UsageEvent[]> {
  try {
    const raw = await readInside(root, usagePath(root));
    const lines = raw.split(/\r?\n/);
    const events: UsageEvent[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!.trim();
      if (!line) continue;
      const event = parseLine(line);
      if (event !== null) events.push(event);
    }
    return events;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function appendUsage(
  root: string,
  event: Omit<UsageEvent, "ts"> & { ts?: string },
): Promise<UsageEvent> {
  const next: UsageEvent = {
    ts: event.ts ?? new Date().toISOString(),
    verb: event.verb,
    ...(event.signature ? { signature: event.signature } : {}),
    ...(event.path ? { path: event.path } : {}),
    ...(event.reason ? { reason: event.reason } : {}),
  };
  const file = usagePath(root);
  return withInsideLock(root, `${file}.lock`, async () => {
    let raw = "";
    try {
      raw = await readInside(root, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const lines = raw.split(/\r?\n/);
    let hasCorrupt = false;
    const validEvents: UsageEvent[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i]!.trim();
      if (!trimmed) continue;
      const parsed = parseLine(trimmed);
      if (parsed === null) {
        hasCorrupt = true;
      } else {
        validEvents.push(parsed);
      }
    }

    if (hasCorrupt) {
      validEvents.push(next);
      await writeInside(root, file, `${validEvents.map((item) => JSON.stringify(item)).join("\n")}\n`);
    } else {
      await appendInside(root, file, `${JSON.stringify(next)}\n`);
    }
    return next;
  });
}

export async function summarizeUsage(root: string): Promise<UsageSummary> {
  const events = await readUsage(root);
  const counts: Record<Verb, number> = {
    search: 0,
    hit: 0,
    miss: 0,
    capture: 0,
    resolve: 0,
    promote: 0,
    discard: 0,
  };
  const lastHits: UsageEvent[] = [];
  const lastDiscards: UsageEvent[] = [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    counts[event.verb] += 1;
    if (event.verb === "hit" && lastHits.length < 5) {
      lastHits.push(event);
    } else if (event.verb === "discard" && lastDiscards.length < 5) {
      lastDiscards.push(event);
    }
  }
  return {
    counts,
    lastHits,
    lastDiscards,
  };
}
