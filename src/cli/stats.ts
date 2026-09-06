import { computeBurrStats } from "../metrics/tracker.js";
import { userHome } from "../shared/home.js";
import type { BurrStats } from "../shared/types.js";

export function renderStatsOutput(stats: BurrStats): string {
  const pad = (label: string, val: string | number, width = 24) => {
    return `  ${label.padEnd(width)} ${String(val).padStart(6)}`;
  };

  const lines = [
    "Burr Stats",
    "",
    "Memory",
    pad("Active memories", stats.memory.active),
    pad("Candidates", stats.memory.candidates),
    pad("Archived", stats.memory.archived),
    pad("Hit rate", `${stats.memory.hitRate}%`),
    pad("Searches", stats.memory.searches),
    "",
    "Learning",
    pad("Memories reused", stats.learning.reusedTotal),
    pad("Successful reuse", stats.learning.successfulReuse),
    pad("Failed reuse", stats.learning.failedReuse),
    pad("Merged memories", stats.learning.merged),
    pad("Promoted memories", stats.learning.promoted),
    "",
    "Runtime",
    pad("Observed sessions", stats.runtime.observedSessions),
    pad("Observed tool calls", stats.runtime.observedCalls),
    pad("Loops detected", stats.runtime.loopsDetected.total),
    pad("  Exact repeats", stats.runtime.loopsDetected.exact),
    pad("  Fuzzy repeats", stats.runtime.loopsDetected.fuzzy),
    pad("  Cycles", stats.runtime.loopsDetected.cycles),
    pad("  Stagnant outputs", stats.runtime.loopsDetected.stagnation),
    pad("Actions blocked", stats.runtime.actionsBlocked),
    pad("Verified recoveries", stats.runtime.verifiedRecoveries),
  ];

  return lines.join("\n");
}

export async function runStats(options: { home?: string } = {}): Promise<number> {
  const home = options.home ?? userHome();
  const stats = await computeBurrStats(home);
  console.log(renderStatsOutput(stats));
  return 0;
}
