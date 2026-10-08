import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findPackageRoot } from "../src/shared/package-root.js";

const SKILLS = [
  "burr",
  "burr-search",
  "burr-capture",
  "burr-resolve",
  "burr-promote",
  "burr-audit",
  "burr-help",
];

describe("canonical package files", () => {
  it("ships seven SKILL.md files with the locked command names", async () => {
    const root = findPackageRoot();
    for (const name of SKILLS) {
      const markdown = await readFile(
        join(root, "skills", name, "SKILL.md"),
        "utf8",
      );
      expect(markdown).toContain(`name: ${name}`);
      expect(markdown).toContain("description:");
    }
  });

  it("ships host plugin manifests that point at the shared skills tree", async () => {
    const root = findPackageRoot();
    const claude = JSON.parse(
      await readFile(join(root, ".claude-plugin", "plugin.json"), "utf8"),
    );
    const codex = JSON.parse(
      await readFile(join(root, ".codex-plugin", "plugin.json"), "utf8"),
    );
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

  it("ships accessible, standalone architecture and workflow SVGs", async () => {
    const root = findPackageRoot();
    for (const name of ["burr-how-it-works.svg", "burr-architecture.svg"]) {
      const svg = await readFile(join(root, "assets", name), "utf8");
      expect(svg).toMatch(/<svg\s+xmlns="http:\/\/www.w3.org\/2000\/svg"/);
      expect(svg).toContain("</svg>");
      expect(svg).not.toContain("\uFFFD");
      expect(svg).toMatch(/<title[^>]*>[^<]+<\/title>/);
      expect(svg).toMatch(/<desc[^>]*>[\s\S]+?<\/desc>/);
      expect(svg).not.toMatch(/<script|<foreignObject|href="https?:/i);
    }
    const architecture = await readFile(
      join(root, "assets", "burr-architecture.svg"),
      "utf8",
    );
    expect(architecture).toContain("~/.burr/memory/");
    expect(architecture).toContain("~/.burr/runs/");
  });

  it("keeps workflow connectors between the stage columns", async () => {
    const root = findPackageRoot();
    const svg = await readFile(
      join(root, "assets", "burr-how-it-works.svg"),
      "utf8",
    );
    const columns = [
      ...svg.matchAll(/<line\s+x1="(\d+)"\s+y1="\d+"\s+x2="(\d+)"/g),
    ].map((match) => ({ start: Number(match[1]), end: Number(match[2]) }));
    const connectors = [...svg.matchAll(/<path\s+d="M(\d+) \d+ H(\d+)"/g)].map(
      (match) => ({ start: Number(match[1]), end: Number(match[2]) }),
    );
    expect(columns.length).toBeGreaterThan(1);
    expect(connectors).toHaveLength(columns.length - 1);
    for (const [index, connector] of connectors.entries()) {
      expect(connector.start).toBeGreaterThan(columns[index].end);
      expect(connector.end).toBeLessThan(columns[index + 1].start);
      expect(connector.end).toBeGreaterThan(connector.start);
    }
  });
});
