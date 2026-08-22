import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli/index.js";
import { withTempDir } from "./helpers.js";

describe("cli", () => {
  it("init via the burr bin entry writes .burr/config.json", async () => {
    await withTempDir(async (dir) => {
      const code = await main(["init", dir]);
      expect(code).toBe(0);
      const config = JSON.parse(await readFile(join(dir, ".burr", "config.json"), "utf8"));
      expect(config.mode).toBe("on");
    });
  });

  it("prints help for unknown commands", async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (line?: unknown) => {
      logs.push(String(line ?? ""));
    };
    try {
      const code = await main(["help"]);
      expect(code).toBe(0);
    } finally {
      console.log = orig;
    }
    expect(logs.join("\n")).toContain("burr init");
    expect(logs.join("\n")).toContain("burr search");
  });
});
