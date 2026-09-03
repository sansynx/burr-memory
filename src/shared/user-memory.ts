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

export async function ensureUserMemory(home?: string): Promise<string> {
  const root = memoryHome(home);
  await Promise.all([
    mkdir(userPlaybooksDir(root), { recursive: true }),
    mkdir(userSignalsDir(root), { recursive: true }),
  ]);
  return root;
}
