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

  it("ships a portable how-it-works SVG without replacement characters", async () => {
    const root = findPackageRoot();
    const svg = await readFile(join(root, "assets", "burr-how-it-works.svg"), "utf8");
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("</svg>");
    expect(svg).not.toContain("\uFFFD");
    expect(svg).toContain("~/.burr/memory");
    expect(svg).toContain("Any project. Same machine.");
  });

  it("keeps how-it-works arrows in the gutters instead of through card titles", async () => {
    const root = findPackageRoot();
    const svg = await readFile(join(root, "assets", "burr-how-it-works.svg"), "utf8");
    const cards = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(1[56]0)" height="128"/g)].map(
      (match) => ({
        x: Number(match[1]),
        y: Number(match[2]),
        width: Number(match[3]),
        height: 128,
      }),
    );
    expect(cards).toHaveLength(5);

    const connectorBlock = svg.slice(
      svg.indexOf("<!-- hooked connectors -->"),
      svg.indexOf("<!-- 1 break -->"),
    );
    const ends = [...connectorBlock.matchAll(/<path d="([^"]+)"/g)]
      .map((match) => {
        const horizontals = [...match[1].matchAll(/\sH(\d+)/g)];
        return Number(horizontals.at(-1)?.[1]);
      })
      .filter((end) => Number.isFinite(end));
    expect(ends).toEqual(cards.slice(1).map((card) => card.x));

    for (const [index, end] of ends.entries()) {
      const previous = cards[index];
      const next = cards[index + 1];
      expect(end).toBeGreaterThan(previous.x + previous.width);
      expect(end).toBe(next.x);
    }

    expect(svg).toMatch(/M475 240 V294 H528/);
  });
});
