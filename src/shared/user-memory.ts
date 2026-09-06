import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { userHome } from "./home.js";

function memoryHome(home?: string): string {
  return home ?? userHome();
}

function userMemoryDir(home?: string): string {
  return join(memoryHome(home), ".burr", "memory");
}

export function userPlaybooksDir(home?: string): string {
  return join(userMemoryDir(home), "playbooks");
}

export function userSignalsDir(home?: string): string {
  return join(userMemoryDir(home), "signals");
}

export function userMemoryRel(kind: "playbooks" | "signals", file: string): string {
  return `~/.burr/memory/${kind}/${basename(file)}`;
}

export function userKnowledgeDir(home?: string): string {
  return join(userMemoryDir(home), "knowledge");
}

export function userToolStrategiesDir(home?: string): string {
  return join(userMemoryDir(home), "tool-strategies");
}

export function userCandidatesDir(home?: string): string {
  return join(memoryHome(home), ".burr", "candidates");
}

export function userRunsDir(home?: string): string {
  return join(memoryHome(home), ".burr", "runs");
}

export function userArchiveDir(home?: string): string {
  return join(memoryHome(home), ".burr", "archive");
}

export function userMetricsDir(home?: string): string {
  return join(memoryHome(home), ".burr", "metrics");
}

export function userMetricsEventsPath(home?: string): string {
  return join(userMetricsDir(home), "events.jsonl");
}

const ensuredMemoryRoots = new Set<string>();

export function clearEnsuredMemoryCache(): void {
  ensuredMemoryRoots.clear();
}

export async function ensureUserMemory(home?: string): Promise<string> {
  const root = memoryHome(home);
  if (ensuredMemoryRoots.has(root)) {
    return root;
  }

  await Promise.all([
    mkdir(userPlaybooksDir(root), { recursive: true }),
    mkdir(userSignalsDir(root), { recursive: true }),
    mkdir(userKnowledgeDir(root), { recursive: true }),
    mkdir(userToolStrategiesDir(root), { recursive: true }),
    mkdir(userCandidatesDir(root), { recursive: true }),
    mkdir(userRunsDir(root), { recursive: true }),
    mkdir(userArchiveDir(root), { recursive: true }),
    mkdir(userMetricsDir(root), { recursive: true }),
  ]);
  ensuredMemoryRoots.add(root);
  return root;
}
