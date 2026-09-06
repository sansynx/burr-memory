import { listRuns, loadRun } from "../runtime/action-ledger.js";
import { userHome } from "../shared/home.js";
import type { RunSummary } from "../shared/types.js";

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  return `${minutes}m${remainingSecs < 10 ? "0" : ""}${remainingSecs}s`;
}

export function renderCompareTable(runA: RunSummary, runB: RunSummary): string {
  const labelA = runA.sessionId.slice(0, 16);
  const labelB = runB.sessionId.slice(0, 16);

  const row = (metric: string, valA: string | number, valB: string | number) => {
    return `  ${metric.padEnd(24)} ${String(valA).padStart(12)} ${String(valB).padStart(12)}`;
  };

  const lines = [
    `Run Comparison`,
    "",
    row("", labelA, labelB),
    `  ${"-".repeat(24)} ${"-".repeat(12)} ${"-".repeat(12)}`,
    row("Verified", runA.verified ? "yes" : "no", runB.verified ? "yes" : "no"),
    row("Tool calls", runA.toolCalls, runB.toolCalls),
    row("Failed calls", runA.failedCalls, runB.failedCalls),
    row("Blocked calls", runA.blockedCalls, runB.blockedCalls),
    row("Repeated actions", runA.repeatedActions, runB.repeatedActions),
    row("Loops detected", runA.loopsDetected, runB.loopsDetected),
    row("Memory hits", runA.memoryHits, runB.memoryHits),
    row("Time", formatDuration(runA.durationMs), formatDuration(runB.durationMs)),
  ];

  return lines.join("\n");
}

export async function runCompare(
  args: string[],
  options: { home?: string } = {},
): Promise<number> {
  const home = options.home ?? userHome();
  const [idA, idB] = args;

  if (!idA || !idB) {
    const available = await listRuns(home);
    console.error("Usage: burr compare <run-a> <run-b>");
    if (available.length > 0) {
      console.error(`Available runs: ${available.slice(-5).join(", ")}`);
    } else {
      console.error("No runs recorded yet in ~/.burr/runs/");
    }
    return 1;
  }

  const [runA, runB] = await Promise.all([loadRun(home, idA), loadRun(home, idB)]);

  if (!runA) {
    console.error(`Error: Run "${idA}" not found in ~/.burr/runs/`);
    return 1;
  }
  if (!runB) {
    console.error(`Error: Run "${idB}" not found in ~/.burr/runs/`);
    return 1;
  }

  console.log(renderCompareTable(runA, runB));
  return 0;
}
