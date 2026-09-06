import { tokenize } from "../shared/tokens.js";
import type { MemoryItem, MemoryScope } from "../shared/types.js";
import { listAllMemories } from "./consolidator.js";

export interface RetrievalQuery {
  scope?: MemoryScope;
  taskDescription?: string;
  error?: string;
  tools?: string[];
  filePaths?: string[];
  limit?: number;
  home?: string;
}

export interface RetrievedMemory {
  item: MemoryItem;
  score: number;
  reasons: string[];
}

export async function retrieveRelevantMemories(query: RetrievalQuery): Promise<RetrievedMemory[]> {
  const all = await listAllMemories(query.home);
  const limit = query.limit ?? 5;

  const queryText = [
    query.taskDescription || "",
    query.error || "",
    (query.tools || []).join(" "),
    (query.filePaths || []).join(" "),
  ]
    .join(" ")
    .trim();

  const queryTokens = new Set(tokenize(queryText));
  const results: RetrievedMemory[] = [];

  for (const item of all) {
    if (item.status === "archived") continue;

    let score = 0;
    const reasons: string[] = [];

    // 1. Scope check
    const queryRepo = query.scope?.repository || (query.scope as { repo?: string })?.repo;
    const itemRepo = item.scope.repository || (item.scope as { repo?: string })?.repo;
    if (queryRepo && itemRepo) {
      if (queryRepo.toLowerCase() === itemRepo.toLowerCase()) {
        score += 40;
        reasons.push("repository-match");
      } else {
        // Different repository scope, skip
        continue;
      }
    } else if (item.scope.level === "global") {
      score += 10;
      reasons.push("global-scope");
    }

    if (query.scope?.framework && item.scope.framework) {
      if (query.scope.framework.toLowerCase() === item.scope.framework.toLowerCase()) {
        score += 20;
        reasons.push("framework-match");
      }
    }

    if (query.scope?.package && item.scope.package) {
      if (query.scope.package.toLowerCase() === item.scope.package.toLowerCase()) {
        score += 20;
        reasons.push("package-match");
      }
    }

    // 2. Token overlap check
    const itemText = [
      item.title,
      item.statement || "",
      item.problem || "",
      item.rootCause || "",
      (item.failedPaths || []).join(" "),
      (item.toolStrategy?.useful || []).join(" "),
    ].join(" ");

    const itemTokens = tokenize(itemText);
    let tokenOverlap = 0;

    for (const t of itemTokens) {
      if (queryTokens.has(t)) {
        tokenOverlap += 1;
      }
    }

    if (tokenOverlap > 0) {
      const tokenScore = Math.min(40, tokenOverlap * 4);
      score += tokenScore;
      reasons.push(`token-overlap-${tokenOverlap}`);
    }

    // 3. Confidence weighting
    score = score * (0.5 + item.confidence * 0.5);

    // 4. Stale penalty
    if (item.status === "stale") {
      score = Math.max(0, score - 15);
      reasons.push("stale-penalty");
    }

    if (score > 0) {
      results.push({
        item,
        score: Number(score.toFixed(1)),
        reasons,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function formatRetrievedMemoriesForContext(memories: RetrievedMemory[]): string {
  if (memories.length === 0) return "";

  const lines = [
    "<!-- burr:active-memory -->",
    "### Burr Learned Memory & Guidance (from verified past tasks)",
  ];

  for (let i = 0; i < memories.length; i += 1) {
    const { item, score } = memories[i]!;
    lines.push(
      `- **[${item.type.toUpperCase()}]** (${Math.round(item.confidence * 100)}% confidence, relevance: ${score})`,
    );
    lines.push(`  ${item.statement || item.title}`);
    if (item.toolStrategy?.useful?.length) {
      lines.push(`  *Recommended tools:* ${item.toolStrategy.useful.join(" -> ")}`);
    }
    if (item.toolStrategy?.wasteful?.length) {
      lines.push(`  *Tools/paths to avoid:* ${item.toolStrategy.wasteful.join(", ")}`);
    }
  }

  lines.push("<!-- end-burr:active-memory -->");
  return lines.join("\n");
}
