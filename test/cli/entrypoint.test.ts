import { execFile } from "node:child_process";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { findPackageRoot } from "../../src/shared/package-root.js";
import { withTempDir } from "../helpers.js";

const exec = promisify(execFile);

async function compileEntry(root: string): Promise<string> {
  const pack = findPackageRoot();
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      extends: join(pack, "tsconfig.json"),
      compilerOptions: {
        outDir: join(root, "dist"),
        typeRoots: [join(pack, "node_modules/@types")],
      },
    }),
  );
  await exec(process.execPath, [
    join(pack, "node_modules/typescript/bin/tsc"),
    "-p",
    join(root, "tsconfig.json"),
  ]);
  const entry = join(root, "dist/cli/command.js");
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await writeFile(
    entry,
    await readFile(join(root, "dist/cli/index.js"), "utf8"),
  );
  return entry;
}

async function invoke(entry: string, root: string) {
  const env = { ...process.env, BURR_HOME: root };
  delete env.VITEST;
  return exec(process.execPath, [entry, "help"], { cwd: root, env });
}

it("runs the actual CLI entry even under an alternate filename", async () => {
  await withTempDir(async (root) => {
    const result = await invoke(await compileEntry(root), root);
    expect(result.stdout).toContain("Usage:");
    expect(result.stderr).toBe("");
  });
}, 30000);

it("runs a POSIX-style burr executable symlink", async (context) => {
  await withTempDir(async (root) => {
    const entry = await compileEntry(root);
    const executable = join(root, "burr");
    try {
      await symlink(entry, executable, "file");
    } catch (error) {
      if (
        process.platform === "win32" &&
        (error as NodeJS.ErrnoException).code === "EPERM"
      ) {
        context.skip("Windows does not grant file-symlink privileges");
        return;
      }
      throw error;
    }
    expect((await invoke(executable, root)).stdout).toContain("Usage:");
  });
}, 30000);

it("does not run the CLI when imported by an unrelated index.js entry", async () => {
  await withTempDir(async (root) => {
    const entry = await compileEntry(root);
    const importer = join(root, "index.js");
    await writeFile(
      importer,
      `import ${JSON.stringify(pathToFileURL(entry).href)};\nconsole.log("import-only");\n`,
    );
    const result = await invoke(importer, root);
    expect(result.stdout.trim()).toBe("import-only");
    expect(result.stderr).toBe("");
  });
}, 30000);
