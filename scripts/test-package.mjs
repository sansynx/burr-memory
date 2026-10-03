import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(join(tmpdir(), "burr-package-"));
const npm = process.env.npm_execpath;
assert(npm, "Run this check through npm run test:package");
const home = join(temporary, "home");
const project = join(temporary, "project");
await Promise.all([mkdir(home), mkdir(project)]);
const env = {
  ...process.env,
  BURR_HOME: home,
  CODEX_HOME: join(home, ".codex"),
};
delete env.VITEST;
const run = (executable, args, cwd = project) =>
  execFileSync(executable, args, {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
  });
try {
  const packed = JSON.parse(
    run(
      process.execPath,
      [npm, "pack", "--json", "--pack-destination", temporary],
      repository,
    ),
  );
  const files = packed[0].files.map((file) => file.path);
  assert(
    !files.some((file) =>
      /^(?:\.burr|\.agents|test|node_modules)\//.test(file),
    ),
    "Unexpected private or development package files",
  );
  const tarball = join(temporary, packed[0].filename);
  await writeFile(
    join(project, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  run(process.execPath, [
    npm,
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    tarball,
  ]);
  const cli = (...args) =>
    run(process.execPath, [
      join(project, "node_modules", "burr-memory", "dist", "cli", "index.js"),
      ...args,
    ]);
  assert.match(
    run(process.execPath, [npm, "exec", "--offline", "--", "burr", "help"]),
    /local debugging memory/i,
  );
  run(process.execPath, [
    "--input-type=module",
    "-e",
    "for (const name of ['burr-memory','burr-memory/api','burr-memory/runtime','burr-memory/learning','burr-memory/codex']) await import(name)",
  ]);
  cli("init");
  const rule = join(project, ".cursor", "rules", "burr.mdc");
  await writeFile(rule, "User-edited rule\n");
  cli("init");
  assert.equal(await readFile(rule, "utf8"), "User-edited rule\n");
  assert.match(
    cli(
      "capture",
      "--error",
      "TypeError: API response users moved",
      "--why",
      "Reusable API schema change",
    ),
    /signals/,
  );
  assert.match(
    cli(
      "resolve",
      "--error",
      "API response users moved",
      "--cause",
      "users is nested under data",
      "--fix",
      "Read data.users after schema validation",
      "--verify",
      "npm test: 12 passed, 0 failed",
    ),
    /playbooks/,
  );
  assert.match(
    cli("search", "API response users"),
    /users is nested under data/,
  );
  assert.match(
    cli(
      "resolve",
      "--error",
      "API response users moved",
      "--cause",
      "schema",
      "--fix",
      "validate",
      "--verify",
      "npm test failed",
    ),
    /discard/,
  );
  assert.match(cli("audit"), /resolve 1/);
  cli("off");
  assert.match(cli("status"), /mode off/);
  cli("on");
  cli("stats");
  cli("memory", "summary");
  cli("doctor");
  console.log(
    `Packaged install passed: ${files.length} package files; executable, exports, repeat init, capture, resolve, search, admission, modes, diagnostics.`,
  );
} finally {
  assert(relative(tmpdir(), temporary).startsWith("burr-package-"));
  await rm(temporary, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
