import { lstat, readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { readInside } from "./fs.js";
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

function score(queryTokens: Set<string>, bag: Set<string>, extra: number): number {
  if (queryTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of queryTokens) {
    if (bag.has(token)) overlap += 1;
  }
  return overlap + extra;
}

async function listMarkdown(dir: string): Promise<string[]> {
  try {
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

async function scoreFile(
  root: string,
  file: string,
  querySet: Set<string>,
  displayPath: string,
  source: MemorySource,
): Promise<SearchHit | null> {
  let markdown: string;
  try {
    markdown = await readInside(root, file);
  } catch {
    return null;
  }
  const { matter, body } = parseFrontmatter(markdown);
  const nameTokens = tokenize(basename(file));
  const matterTokens = tokenize(matter);
  const bodyTokens = tokenize(body);
  const nameSet = new Set(nameTokens);
  const matterSet = new Set(matterTokens);
  const extra = score(querySet, nameSet, 0) * 1 + score(querySet, matterSet, 0) * 0.5;
  const allTokens = new Set(nameTokens);
  for (const t of matterTokens) allTokens.add(t);
  for (const t of bodyTokens) allTokens.add(t);
  const total = score(querySet, allTokens, extra);
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
  if (queryTokens.length === 0) return [];
  const querySet = new Set(queryTokens);

  const projectDirs = [
    join(root, ".burr", "memory", "playbooks"),
    join(root, ".burr", "memory", "signals"),
  ];
  const projectFiles = (await Promise.all(projectDirs.map(listMarkdown))).flat();
  const projectHitsPromise = Promise.all(
    projectFiles.map((file) => scoreFile(root, file, querySet, relative(root, file), "project")),
  );

  let globalHitsPromise: Promise<(SearchHit | null)[]> = Promise.resolve([]);
  if (options.home !== undefined) {
    const home = options.home;
    globalHitsPromise = Promise.all([
      listMarkdown(userPlaybooksDir(home)),
      listMarkdown(userSignalsDir(home)),
    ]).then(async ([playbooks, signals]) => {
      const globalFiles = [...playbooks, ...signals];
      return Promise.all(
        globalFiles.map((file) => {
          const kind = file.replaceAll("\\", "/").includes("/signals/") ? "signals" : "playbooks";
          return scoreFile(home, file, querySet, userMemoryRel(kind, file), "global");
        }),
      );
    });
  }

  const [projectHitsRaw, globalHitsRaw] = await Promise.all([projectHitsPromise, globalHitsPromise]);
  const hits: SearchHit[] = [];
  for (const hit of projectHitsRaw) {
    if (hit) hits.push(hit);
  }
  for (const hit of globalHitsRaw) {
    if (hit) hits.push(hit);
  }

  return hits
    .sort((a, b) => {
      if (a.source !== b.source) return a.source === "global" ? -1 : 1;
      return b.score - a.score;
    })
    .slice(0, 5);
}
