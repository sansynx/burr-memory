import { codexHookCommand, mergeCodexHooks } from "../shared/codex.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  writeIfMissing,
  resolveProjectRoot,
  readInside,
  writeInside,
} from "../shared/fs.js";
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

export async function runInit(
  cwd: string,
  options: InitOptions = {},
): Promise<InitResult> {
  const log = options.log ?? (() => undefined);
  const root = await resolveProjectRoot(cwd);
  const pack = findPackageRoot();
  const created: string[] = [];
  const skipped: string[] = [];

  const note = (rel: string, result: "created" | "skipped") => {
    const path = posix(rel);
    if (result === "created") created.push(path);
    else skipped.push(path);
  };

  const write = async (rel: string, data: string) => {
    if (rel === ".opencode/plugins/burr.mjs") {
      const existing = await readInside(root, join(root, rel)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "";
          throw error;
        },
      );
      if (
        createHash("sha256")
          .update(existing.replace(/\r\n/g, "\n"))
          .digest("hex") ===
        "a5c7bb380666b9f1442b1c5b2aa631b1b05d38c7bfdc7b6f814464e90a2a8082"
      ) {
        await writeInside(root, join(root, rel), data);
        note(rel, "created");
        return;
      }
    }
    const result = await writeIfMissing(root, join(root, rel), data);
    note(rel, result);
  };

  const [instructions, config, plugin, skillsData] = await Promise.all([
    readFile(join(pack, "templates", "instructions.md"), "utf8"),
    readFile(join(pack, "templates", "config.json"), "utf8"),
    readFile(join(pack, ".opencode", "plugins", "burr.mjs"), "utf8"),
    Promise.all(
      SKILLS.map((name) =>
        readFile(join(pack, "skills", name, "SKILL.md"), "utf8"),
      ),
    ),
  ]);

  await write(
    ".burr/config.json",
    config.endsWith("\n") ? config : `${config}\n`,
  );
  await write(
    ".burr/instructions.md",
    instructions.endsWith("\n") ? instructions : `${instructions}\n`,
  );
  await write(".burr/usage.jsonl", "");
  note(".gitignore", await ensureBurrGitignore(root));

  for (let i = 0; i < SKILLS.length; i += 1) {
    const name = SKILLS[i]!;
    const skill = skillsData[i]!;
    for (const tree of [
      ".burr/skills",
      ".claude/skills",
      ".agents/skills",
      ".pi/skills",
    ]) {
      await write(`${tree}/${name}/SKILL.md`, skill);
    }
    await write(`.opencode/command/${name}.md`, skill);
  }

  await write(
    ".opencode/plugins/burr.mjs",
    plugin.replace(
      'new URL("../../dist/codex/index.js", import.meta.url).href',
      JSON.stringify(
        pathToFileURL(join(pack, "dist", "codex", "index.js")).href,
      ),
    ),
  );
  await write(".cursor/rules/burr.mdc", `${CURSOR_FRONTMATTER}${instructions}`);
  await write(
    ".windsurf/rules/burr.md",
    instructions.endsWith("\n") ? instructions : `${instructions}\n`,
  );

  for (const file of ["opencode.json", ".opencode/opencode.json"]) {
    const result = await mergeOpenCodePlugin(root, file, PLUGIN_PATH);
    await note(file, result);
  }

  note(
    ".codex/hooks.json",
    await mergeCodexHooks(root, ".codex/hooks.json", codexHookCommand(pack)),
  );
  log("Review and trust Burr hooks in Codex /hooks before their first run.");

  log("Created:");
  if (created.length === 0) log("  (none)");
  for (const path of created) log(`  ${path}`);
  if (skipped.length) {
    log("Skipped (exists):");
    for (const path of skipped) log(`  ${path}`);
  }
  log(
    "No existing instruction file was modified. Burr never edits AGENTS.md or CLAUDE.md.",
  );
  log("No key asked. No network used.");

  return { created, skipped, untouchedInstructions: true };
}
