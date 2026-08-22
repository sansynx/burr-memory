import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findPackageRoot } from "../src/shared/package-root.js";

describe("publish surface", () => {
  it("ships as burr-memory with a burr binary and a license", async () => {
    const root = findPackageRoot();
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(pkg.name).toBe("burr-memory");
    expect(pkg.bin.burr).toBe("dist/cli/index.js");
    expect(pkg.files).toContain("LICENSE");
    expect(pkg.files).toContain(".opencode/plugins/burr.mjs");
    expect(pkg.files).not.toContain(".opencode");
    expect(pkg.scripts.build).toContain("npm run clean");
    expect(pkg.scripts.prepublishOnly).toContain("npm run check");
    expect(pkg.repository.url).toBe("git+https://github.com/sansynx/burr-memory.git");
    expect(pkg.homepage).toBe("https://github.com/sansynx/burr-memory#readme");
    expect(pkg.bugs.url).toBe("https://github.com/sansynx/burr-memory/issues");
    expect(pkg.author).toBeUndefined();
    expect(JSON.stringify(pkg)).not.toMatch(/sanat|gmail\.com|Users/i);
    const license = await readFile(join(root, "LICENSE"), "utf8");
    expect(license).toContain("MIT License");
    expect(license).not.toMatch(/sanat|gmail\.com/i);
  });
});
