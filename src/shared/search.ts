import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tokenize } from "./tokens.js";
import type { SearchHit } from "./types.js";

function parseFrontmatter(markdown: string): { matter: string; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { matter: "", body: markdown };
  return { matter: match[1], body: match[2] };
}

function excerpt(body: string): string {
  const section = body.match(/## (?:Root Cause|Fix)\r?\n+([\s\S]*?)(?:\r?\n## |\s*$)/i);
  const text = (section?.[1] ?? body).trim().replace(/\s+/g, " ");
  return text.slice(0, 400);
}

function score(queryTokens: string[], fileTokens: string[], extra: number): number {
  if (queryTokens.length === 0) return 0;
  const bag = new Set(fileTokens);
  let overlap = 0;
  for (const token of new Set(queryTokens)) {
    if (bag.has(token)) overlap += 1;
  }
  return overlap + extra;
}

async function listMarkdown(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names.filter((name) => name.endsWith(".md")).map((name) => join(dir, name));
  } catch {
    return [];
  }
}

export async function searchMemoryFiles(root: string, query: string): Promise<SearchHit[]> {
  const queryTokens = tokenize(query);
  const dirs = [
    join(root, ".burr", "memory", "playbooks"),
    join(root, ".burr", "memory", "signals"),
  ];
  const files = (await Promise.all(dirs.map(listMarkdown))).flat();
  const hits: SearchHit[] = [];

  for (const file of files) {
    const markdown = await readFile(file, "utf8");
    const { matter, body } = parseFrontmatter(markdown);
    const nameTokens = tokenize(file);
    const matterTokens = tokenize(matter);
    const bodyTokens = tokenize(body);
    const extra = score(queryTokens, nameTokens, 0) * 1 + score(queryTokens, matterTokens, 0) * 0.5;
    const total = score(queryTokens, [...nameTokens, ...matterTokens, ...bodyTokens], extra);
    if (total <= 0) continue;
    hits.push({
      path: relative(root, file),
      score: total,
      excerpt: excerpt(body),
    });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, 5);
}
