import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { UsageEvent, UsageSummary, Verb } from "./types.js";

const VERBS: Verb[] = ["search", "hit", "miss", "capture", "resolve", "discard"];

function usagePath(root: string): string {
  return join(root, ".burr", "usage.jsonl");
}

function parseLine(line: string): UsageEvent | null {
  try {
    const parsed = JSON.parse(line) as UsageEvent;
    if (!parsed || typeof parsed.ts !== "string" || !VERBS.includes(parsed.verb)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function readUsage(root: string): Promise<UsageEvent[]> {
  try {
    const raw = await readFile(usagePath(root), "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseLine)
      .filter((event): event is UsageEvent => event !== null);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function isCorrupt(root: string): Promise<boolean> {
  try {
    const raw = await readFile(usagePath(root), "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .some((line) => parseLine(line) === null);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
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
  await mkdir(dirname(file), { recursive: true });
  if (await isCorrupt(root)) {
    const events = await readUsage(root);
    events.push(next);
    await writeFile(file, `${events.map((item) => JSON.stringify(item)).join("\n")}\n`);
    return next;
  }
  await appendFile(file, `${JSON.stringify(next)}\n`);
  return next;
}

export async function summarizeUsage(root: string): Promise<UsageSummary> {
  const events = await readUsage(root);
  const counts = Object.fromEntries(VERBS.map((verb) => [verb, 0])) as Record<Verb, number>;
  for (const event of events) counts[event.verb] += 1;
  return {
    counts,
    lastHits: events.filter((event) => event.verb === "hit").slice(-5).reverse(),
    lastDiscards: events.filter((event) => event.verb === "discard").slice(-5).reverse(),
  };
}
