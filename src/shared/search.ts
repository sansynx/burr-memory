import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import {
  userPlaybooksDir,
  userSignalsDir,
  userMemoryRel,
} from "./user-memory.js";
import { tokenize } from "./tokens.js";
import type { MemorySource, SearchHit } from "./types.js";

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

async function scoreFile(
  file: string,
  queryTokens: string[],
  displayPath: string,
  source: MemorySource,
): Promise<SearchHit | null> {
  const markdown = await readFile(file, "utf8");
  const { matter, body } = parseFrontmatter(markdown);
  const nameTokens = tokenize(basename(file));
  const matterTokens = tokenize(matter);
  const bodyTokens = tokenize(body);
  const extra = score(queryTokens, nameTokens, 0) * 1 + score(queryTokens, matterTokens, 0) * 0.5;
  const total = score(queryTokens, [...nameTokens, ...matterTokens, ...bodyTokens], extra);
  if (total <= 0) return null;
  return {
    path: displayPath.replaceAll("\\", "/"),
    score: total,
    excerpt: excerpt(body),
    source,
  };
}

export async function searchMemoryFiles(
  root: string,
  query: string,
  options: { home?: string } = {},
): Promise<SearchHit[]> {
  const queryTokens = tokenize(query);
  const hits: SearchHit[] = [];

  const projectDirs = [
    join(root, ".burr", "memory", "playbooks"),
    join(root, ".burr", "memory", "signals"),
  ];
  const projectFiles = (await Promise.all(projectDirs.map(listMarkdown))).flat();
  for (const file of projectFiles) {
    const hit = await scoreFile(file, queryTokens, relative(root, file), "project");
    if (hit) hits.push(hit);
  }

  if (options.home !== undefined) {
    const globalFiles = (
      await Promise.all([
        listMarkdown(userPlaybooksDir(options.home)),
        listMarkdown(userSignalsDir(options.home)),
      ])
    ).flat();
    for (const file of globalFiles) {
      const kind = file.replaceAll("\\", "/").includes("/signals/") ? "signals" : "playbooks";
      const hit = await scoreFile(file, queryTokens, userMemoryRel(kind, file), "global");
      if (hit) hits.push(hit);
    }
  }

  return hits
    .sort((a, b) => {
      if (a.source !== b.source) return a.source === "global" ? -1 : 1;
      return b.score - a.score;
    })
    .slice(0, 5);
}
