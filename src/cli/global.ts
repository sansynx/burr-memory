import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeIfMissing, writeInside } from "../shared/fs.js";
import { userHome } from "../shared/home.js";
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

const CURSOR_FRONTMATTER = `---
description: Local debugging memory. Search shared Burr memory before non-trivial fixes.
alwaysApply: true
---

`;

const PLUGIN_PATH = "./plugins/burr.mjs";
const MANAGED_MARKER = "burr-managed: 2";
const LEGACY_SKILL_HASHES: Record<(typeof SKILLS)[number], string[]> = {
  burr: [
    "7cc7ef26f5ef33395f2ecaa14f456d66bf2d61b8cb297905aad9305938a42e99",
    "18203305adc1fa58071ea87bb2177a788eb5580705abfdc09ac6fd80224b4633",
  ],
  "burr-search": [
    "aa97252568466cd139f73138883e4f6295e6364400dc4becf8e0ae87d89550b5",
    "f635305eeb960f3890732e8212c5309afb8f5d9e3a46dcc85d6e47bb0c36947e",
  ],
  "burr-capture": [
    "bc2da5ebb465452456bc0d6e3264a7bcb4d1564bb6d1b6f983b16af9d6ada1e0",
    "b51d508661ac378693efd0e3227f9f851c4be21f3e25dbfb88ace3dd4a76cb9f",
  ],
  "burr-resolve": [
    "458bf081b46044b9a30a50a7e0ae1c92dd86db402ecefffaac9584a184c845a8",
    "9be7b36de1c63a05ea45976f76e579851d05418e32b9211f7b91bf77a93ebfe9",
  ],
  "burr-promote": [
    "051c270e86fe0c9f3a97208d45cfc8fc940e7c5c2e957b6f36b71b23b1381427",
  ],
  "burr-audit": [
    "49e67a85330cc047293bbbb2b71329d0e5670ca62b001af921afb17e58d3f37a",
    "ab3182fd1b761f4477a2695e5a021b070ae74e63f8b5f1c43be7ecc729f2482f",
  ],
  "burr-help": [
    "dccc51e1a3aa20824f5bbf14f81d52ebafd555862a5268bd4bcfb4deb492e250",
    "32a07cbfc018a3d8723ce664c642e3e9e4847ef838188aefc6fddb6c719cebaa",
  ],
};

export interface GlobalResult {
  created: string[];
  skipped: string[];
}

function posix(path: string): string {
  return path.replaceAll("\\", "/");
}

function markSkill(markdown: string): string {
  const match = markdown.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/);
  if (!match) return `<!-- ${MANAGED_MARKER} -->\n${markdown}`;
  return `${match[1]}<!-- ${MANAGED_MARKER} -->\n${match[2]}`;
}

export async function runGlobal(
  options: { log?: (line: string) => void; home?: string } = {},
): Promise<GlobalResult> {
  const log = options.log ?? (() => undefined);
  const home = options.home ?? userHome();
  const pack = findPackageRoot();
  const created: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  const note = (rel: string, result: "created" | "skipped") => {
    const path = posix(rel);
    if (result === "created") created.push(path);
    else skipped.push(path);
  };

  const write = async (
    rel: string,
    data: string,
    knownLegacy: string[] = [],
  ) => {
    const dest = join(home, rel);
    let result: "created" | "skipped";
    try {
      const existing = await readFile(dest, "utf8");
      const hash = createHash("sha256")
        .update(existing.replace(/\r\n/g, "\n"))
        .digest("hex");
      if (existing.includes(MANAGED_MARKER)) {
        result = "skipped";
      } else if (/burr-managed:\s*\d+/.test(existing) || knownLegacy.includes(hash)) {
        await writeInside(home, dest, data);
        result = "created";
      } else {
        warnings.push(`  ~/${posix(rel)} (legacy or edited; replace manually)`);
        result = "skipped";
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      result = await writeIfMissing(home, dest, data);
    }
    note(rel, result);
  };

  const instructions = await readFile(join(pack, "templates", "global-instructions.md"), "utf8");
  const plugin = await readFile(join(pack, ".opencode", "plugins", "burr.mjs"), "utf8");
  const managedInstructions = `<!-- ${MANAGED_MARKER} -->\n${instructions}`;
  const cursor = `${CURSOR_FRONTMATTER}${managedInstructions}`;
  const windsurf = managedInstructions.endsWith("\n")
    ? managedInstructions
    : `${managedInstructions}\n`;

  await write(
    ".cursor/rules/burr.mdc",
    cursor,
    ["449e17fdf0dca721281103adaa41e39c937cbc22761022687eee3df3e23a9aaa"],
  );
  await write(
    ".windsurf/rules/burr.md",
    windsurf,
    ["ef5d6f893d986c504e29e47d7d8a2f76194ba354a1e0bff989b227aa78db97e9"],
  );

  for (const name of SKILLS) {
    const skill = await readFile(join(pack, "skills", name, "SKILL.md"), "utf8");
    const managedSkill = markSkill(skill);
    await write(
      `.claude/skills/${name}/SKILL.md`,
      managedSkill,
      LEGACY_SKILL_HASHES[name],
    );
    await write(
      `.agents/skills/${name}/SKILL.md`,
      managedSkill,
      LEGACY_SKILL_HASHES[name],
    );
    await write(
      `.pi/agent/skills/${name}/SKILL.md`,
      managedSkill,
      LEGACY_SKILL_HASHES[name],
    );
  }

  await write(
    ".config/opencode/plugins/burr.mjs",
    plugin,
    ["859fe880466c21d9bc27ba2c8020ef6c48c23c6651a663e9b3e63416a56ae617"],
  );
  await write(
    ".config/opencode/burr-instructions.md",
    windsurf,
    ["ef5d6f893d986c504e29e47d7d8a2f76194ba354a1e0bff989b227aa78db97e9"],
  );
  note(
    ".config/opencode/opencode.json",
    await mergeOpenCodePlugin(home, ".config/opencode/opencode.json", PLUGIN_PATH),
  );

  log("Created:");
  if (created.length === 0) log("  (none)");
  for (const path of created) log(`  ~/${path}`);
  if (skipped.length) {
    log("Skipped (exists):");
    for (const path of skipped) log(`  ~/${path}`);
  }
  if (warnings.length) {
    log("Needs manual refresh (preserved because it may be edited):");
    for (const warning of warnings) log(warning);
  }
  log("Burr is on for new projects. Playbooks live in ~/.burr/memory/ on this machine.");
  log("No key asked. No network used.");

  return { created, skipped };
}
