import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { withTempDir } from "../helpers.js";

describe("cli edges", () => {
  it("returns 1 when search has no query", async () => {
    const errors: string[] = [];
    const orig = console.error;
    console.error = (line?: unknown) => {
      errors.push(String(line ?? ""));
    };
    try {
      expect(await main(["search"])).toBe(1);
    } finally {
      console.error = orig;
    }
    expect(errors.join("\n")).toContain("burr search");
  });

  it("returns 1 when capture has no error", async () => {
    expect(await main(["capture"])).toBe(1);
  });

  it("returns 1 when resolve is missing verification", async () => {
    expect(await main(["resolve", "--error", "x", "--cause", "y", "--fix", "z"])).toBe(1);
  });

  it("audit of an empty project says there is no usage yet", async () => {
    await withTempDir(async (dir) => {
      const prev = process.cwd();
      process.chdir(dir);
      const logs: string[] = [];
      const orig = console.log;
      console.log = (line?: unknown) => {
        logs.push(String(line ?? ""));
      };
      try {
        expect(await main(["audit"])).toBe(0);
      } finally {
        console.log = orig;
        process.chdir(prev);
      }
      expect(logs.join("\n")).toMatch(/no usage yet/i);
    });
  });
});
