import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeIfMissing, resolveProjectRoot } from "../shared/fs.js";
import { ensureBurrGitignore } from "../shared/gitignore.js";
import { mergeOpenCodePlugin } from "../shared/opencode.js";
import { findPackageRoot } from "../shared/package-root.js";

const SKILLS = [
  "burr",
  "burr-search",
  "burr-capture",
  "burr-resolve",
  "burr-promote",
  "burr-audit",
  "burr-help",
] as const;

const PLUGIN_PATH = "./.opencode/plugins/burr.mjs";
const CURSOR_FRONTMATTER = `---
description: Local debugging memory. Search shared Burr memory before non-trivial fixes.
alwaysApply: true
---

`;

export interface InitResult {
  created: string[];
  skipped: string[];
  untouchedInstructions: true;
}

export interface InitOptions {
  log?: (line: string) => void;
}

function posix(path: string): string {
  return path.replaceAll("\\", "/");
}

export async function runInit(cwd: string, options: InitOptions = {}): Promise<InitResult> {
  const log = options.log ?? (() => undefined);
  const root = await resolveProjectRoot(cwd);
  const pack = findPackageRoot();
  const created: string[] = [];
  const skipped: string[] = [];

  const note = async (rel: string, result: "created" | "skipped") => {
    const path = posix(rel);
    if (result === "created") created.push(path);
    else skipped.push(path);
  };

  const write = async (rel: string, data: string) => {
    const result = await writeIfMissing(root, join(root, rel), data);
    await note(rel, result);
  };

  const instructions = await readFile(join(pack, "templates", "instructions.md"), "utf8");
  const config = await readFile(join(pack, "templates", "config.json"), "utf8");
  const plugin = await readFile(join(pack, ".opencode", "plugins", "burr.mjs"), "utf8");

  await write(".burr/config.json", config.endsWith("\n") ? config : `${config}\n`);
  await write(".burr/instructions.md", instructions.endsWith("\n") ? instructions : `${instructions}\n`);
  await write(".burr/usage.jsonl", "");
  await note(".gitignore", await ensureBurrGitignore(root));

  for (const name of SKILLS) {
    const skill = await readFile(join(pack, "skills", name, "SKILL.md"), "utf8");
    for (const tree of [".burr/skills", ".claude/skills", ".agents/skills", ".pi/skills"]) {
      await write(`${tree}/${name}/SKILL.md`, skill);
    }
    await write(`.opencode/command/${name}.md`, skill);
  }

  await write(".opencode/plugins/burr.mjs", plugin);
  await write(".cursor/rules/burr.mdc", `${CURSOR_FRONTMATTER}${instructions}`);
  await write(".windsurf/rules/burr.md", instructions.endsWith("\n") ? instructions : `${instructions}\n`);

  for (const file of ["opencode.json", ".opencode/opencode.json"]) {
    const result = await mergeOpenCodePlugin(root, file, PLUGIN_PATH);
    await note(file, result);
  }

  log("Created:");
  if (created.length === 0) log("  (none)");
  for (const path of created) log(`  ${path}`);
  if (skipped.length) {
    log("Skipped (exists):");
    for (const path of skipped) log(`  ${path}`);
  }
  log("No existing instruction file was modified. Burr never edits AGENTS.md or CLAUDE.md.");
  log("No key asked. No network used.");

  return { created, skipped, untouchedInstructions: true };
}
