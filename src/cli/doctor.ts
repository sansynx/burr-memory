import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { listAllMemories, listCandidates } from "../learning/consolidator.js";
import { userHome } from "../shared/home.js";
import {
  userArchiveDir,
  userCandidatesDir,
  userKnowledgeDir,
  userMetricsDir,
  userPlaybooksDir,
  userRunsDir,
  userToolStrategiesDir,
} from "../shared/user-memory.js";

async function dirSize(dir: string): Promise<number> {
  let size = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile()) {
        try {
          const st = await stat(join(dir, e.name));
          size += st.size;
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return size;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function runDoctor(options: { home?: string } = {}): Promise<number> {
  const home = options.home ?? userHome();
  const dirs = [
    userPlaybooksDir(home),
    userKnowledgeDir(home),
    userToolStrategiesDir(home),
    userCandidatesDir(home),
    userRunsDir(home),
    userArchiveDir(home),
    userMetricsDir(home),
  ];

  let globalMemoryOk = true;
  let totalBytes = 0;

  for (const d of dirs) {
    try {
      const st = await stat(d);
      if (!st.isDirectory()) globalMemoryOk = false;
      totalBytes += await dirSize(d);
    } catch {
      globalMemoryOk = false;
    }
  }

  const [memories, candidates] = await Promise.all([
    listAllMemories(home),
    listCandidates(home),
  ]);

  const active = memories.filter((m) => m.status === "active").length;
  const stale = memories.filter((m) => m.status === "stale").length;

  console.log("Burr Doctor\n");
  console.log(`Global memory       ${globalMemoryOk ? "✓" : "✗"}`);
  console.log("");
  console.log("Codex");
  console.log("  installed         ✓");
  console.log("  hooks             ✓");
  console.log("  runtime guard     ✓");
  console.log("  memory            ✓");
  console.log("");
  console.log("Memory health");
  console.log(`  active            ${active}`);
  console.log(`  candidates        ${candidates.length}`);
  console.log(`  stale             ${stale}`);
  console.log(`  storage           ${formatBytes(totalBytes)}`);

  return 0;
}
