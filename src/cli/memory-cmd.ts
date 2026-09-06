import {
  applyMemoryDecayAndPruning,
  getMemory,
  listAllMemories,
  listCandidates,
} from "../learning/consolidator.js";
import { cleanOldRuns } from "../runtime/action-ledger.js";
import { userHome } from "../shared/home.js";

export async function runMemoryCmd(
  args: string[],
  options: { home?: string } = {},
): Promise<number> {
  const home = options.home ?? userHome();
  const subcommand = args[0] || "summary";

  if (subcommand === "summary") {
    const [memories, candidates] = await Promise.all([
      listAllMemories(home),
      listCandidates(home),
    ]);

    const active = memories.filter((m) => m.status === "active").length;
    const archived = memories.filter((m) => m.status === "archived").length;
    const stale = memories.filter((m) => m.status === "stale").length;

    console.log("Burr Memory");
    console.log(`  Active memories:     ${active}`);
    console.log(`  Stale memories:      ${stale}`);
    console.log(`  Candidates:          ${candidates.length}`);
    console.log(`  Archived:            ${archived}`);
    return 0;
  }

  if (subcommand === "list") {
    const memories = await listAllMemories(home);
    if (memories.length === 0) {
      console.log("No memories stored in ~/.burr/memory/ yet.");
      return 0;
    }

    console.log(`Stored Memories (${memories.length}):\n`);
    for (const m of memories) {
      const scopeLabel = m.scope.repository || m.scope.level;
      const confPct = `${Math.round(m.confidence * 100)}%`;
      console.log(`- [${m.id}] [${m.type.toUpperCase()}] [${m.status}] (${confPct}, scope: ${scopeLabel})`);
      console.log(`  ${m.statement || m.title}`);
    }
    return 0;
  }

  if (subcommand === "inspect") {
    const id = args[1];
    if (!id) {
      console.error("Usage: burr memory inspect <id>");
      return 1;
    }

    const item = await getMemory(id, home);
    if (!item) {
      // Check candidates too
      const candidates = await listCandidates(home);
      const cand = candidates.find((c) => c.id === id);
      if (cand) {
        console.log(JSON.stringify(cand, null, 2));
        return 0;
      }
      console.error(`Memory item "${id}" not found.`);
      return 1;
    }

    console.log(JSON.stringify(item, null, 2));
    return 0;
  }

  if (subcommand === "prune") {
    console.log("Applying memory decay and cleaning old run history...");
    const result = await applyMemoryDecayAndPruning(home);
    const runsDeleted = await cleanOldRuns(home, 7);

    console.log(`Pruning complete:`);
    console.log(`  Staled:   ${result.staled}`);
    console.log(`  Archived: ${result.archived}`);
    console.log(`  Pruned:   ${result.pruned}`);
    console.log(`  Expired runs deleted: ${runsDeleted}`);
    return 0;
  }

  console.error(`Unknown memory subcommand: "${subcommand}". Usage: burr memory [list | inspect <id> | prune]`);
  return 1;
}
