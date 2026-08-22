import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findPackageRoot } from "../src/shared/package-root.js";

const SKILLS = [
  "burr",
  "burr-search",
  "burr-capture",
  "burr-resolve",
  "burr-audit",
  "burr-help",
];

describe("canonical package files", () => {
  it("ships six SKILL.md files with the locked command names", async () => {
    const root = findPackageRoot();
    for (const name of SKILLS) {
      const markdown = await readFile(join(root, "skills", name, "SKILL.md"), "utf8");
      expect(markdown).toContain(`name: ${name}`);
      expect(markdown).toContain("description:");
    }
  });

  it("ships host plugin manifests that point at the shared skills tree", async () => {
    const root = findPackageRoot();
    const claude = JSON.parse(await readFile(join(root, ".claude-plugin", "plugin.json"), "utf8"));
    const codex = JSON.parse(await readFile(join(root, ".codex-plugin", "plugin.json"), "utf8"));
    expect(claude.name).toBe("burr");
    expect(codex.name).toBe("burr");
    expect(codex.skills).toBe("./skills/");
  });

  it("ships the locked mark with no letters", async () => {
    const root = findPackageRoot();
    const svg = await readFile(join(root, "assets", "burr-mark.svg"), "utf8");
    expect(svg).toContain("#0F0F0E");
    expect(svg).toContain("#F4EEE7");
    expect(svg).toContain("#FF5A1F");
    expect(svg).not.toMatch(/>Burr</);
    expect(svg).not.toMatch(/>burr</);
  });
});
