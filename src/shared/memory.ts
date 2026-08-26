import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { admitResolution, admitSignal } from "./admission.js";
import { ATTEMPT_COUNT, ATTEMPT_LIMIT, SHORT_LIMIT, TEXT_LIMIT, clip } from "./bounds.js";
import { ensureStore } from "./ensure-store.js";
import { BurrFsError, readInside, writeIfMissing, writeInside } from "./fs.js";
import { userHome } from "./home.js";
import {
  ensureUserMemory,
  userMemoryRel,
  userPlaybooksDir,
  userSignalsDir,
} from "./user-memory.js";
import { appendUsage, readUsage, summarizeUsage } from "./ledger.js";
import { renderPlaybook, renderSignal, signature } from "./playbook.js";
import { redact } from "./redaction.js";
import { searchMemoryFiles } from "./search.js";
import type { CaptureInput, Mode, ResolveInput, SearchHit } from "./types.js";

function boundList(items: string[] | undefined, count: number, limit: number): string[] {
  return (items ?? []).slice(0, count).map((item) => clip(item, limit));
}

function titleFrom(error: string, fallback: string): string {
  const line = clip(error.split(/\r?\n/)[0], SHORT_LIMIT);
  return line || fallback;
}

function redactShort(value: unknown): string | undefined {
  return typeof value === "string" ? clip(redact(value), SHORT_LIMIT) : undefined;
}

export async function captureSignal(
  root: string,
  input: CaptureInput,
  options: { home?: string } = {},
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const bounded: CaptureInput = {
    ...input,
    error: clip(input.error ?? "", TEXT_LIMIT),
    stack: input.stack ? clip(input.stack, TEXT_LIMIT) : undefined,
    command: input.command ? clip(input.command, SHORT_LIMIT) : undefined,
    exitCode:
      input.exitCode === undefined ? undefined : clip(redact(String(input.exitCode)), SHORT_LIMIT),
    attemptedFixes: boundList(input.attemptedFixes, ATTEMPT_COUNT, ATTEMPT_LIMIT),
    whyKeep: input.whyKeep ? clip(input.whyKeep, TEXT_LIMIT) : undefined,
    rootCause: input.rootCause ? clip(input.rootCause, TEXT_LIMIT) : undefined,
  };
  const home = options.home ?? userHome();
  await ensureStore(root);
  await ensureUserMemory(home);
  if (!bounded.error.trim()) {
    await appendUsage(root, { verb: "discard", reason: "empty-error" });
    return { ok: false, reason: "empty-error" };
  }
  const sig = signature(bounded.error);
  const admission = admitSignal(bounded);
  if (!admission.ok) {
    await appendUsage(root, { verb: "discard", reason: admission.reason, signature: sig });
    return { ok: false, reason: admission.reason ?? "discard" };
  }

  const filename = `${sig}.md`;
  const path = userMemoryRel("signals", filename);
  await writeInside(
    home,
    join(".burr", "memory", "signals", filename),
    renderSignal({
      title: redact(titleFrom(bounded.error, "Signal")),
      signature: sig,
      error: redact(bounded.error),
      stack: bounded.stack ? redact(bounded.stack) : undefined,
      command: bounded.command ? redact(bounded.command) : undefined,
      exitCode: bounded.exitCode,
      attemptedFixes: bounded.attemptedFixes?.map((item) => redact(item)),
      whyKeep: bounded.whyKeep ? redact(bounded.whyKeep) : undefined,
    }),
  );
  await appendUsage(root, { verb: "capture", path, signature: sig });
  return { ok: true, path };
}

export async function resolvePlaybook(
  root: string,
  input: ResolveInput,
  options: { home?: string } = {},
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const bounded: ResolveInput = {
    ...input,
    error: clip(input.error ?? "", TEXT_LIMIT),
    rootCause: clip(input.rootCause ?? "", TEXT_LIMIT),
    fix: clip(input.fix ?? "", TEXT_LIMIT),
    verification: clip(input.verification ?? "", TEXT_LIMIT),
    failedAttempts: boundList(input.failedAttempts, ATTEMPT_COUNT, ATTEMPT_LIMIT),
    context: input.context
      ? {
          language: redactShort(input.context.language),
          framework: redactShort(input.context.framework),
          risk: redactShort(input.context.risk),
          confidence: redactShort(input.context.confidence),
        }
      : undefined,
  };
  const home = options.home ?? userHome();
  await ensureStore(root);
  await ensureUserMemory(home);
  if (!bounded.error.trim() || !bounded.rootCause.trim() || !bounded.fix.trim()) {
    await appendUsage(root, { verb: "discard", reason: "empty-error" });
    return { ok: false, reason: "empty-error" };
  }
  const sig = signature(`${bounded.error}\n${bounded.rootCause}`);
  const admission = admitResolution(bounded);
  if (!admission.ok) {
    await appendUsage(root, { verb: "discard", reason: admission.reason, signature: sig });
    return { ok: false, reason: admission.reason ?? "discard" };
  }

  const filename = `${sig}.md`;
  const path = userMemoryRel("playbooks", filename);
  await writeInside(
    home,
    join(".burr", "memory", "playbooks", filename),
    renderPlaybook({
      title: redact(titleFrom(bounded.error, "Playbook")),
      signature: sig,
      error: redact(bounded.error),
      rootCause: redact(bounded.rootCause),
      fix: redact(bounded.fix),
      failedAttempts: bounded.failedAttempts?.map((item) => redact(item)),
      verification: redact(bounded.verification),
      context: bounded.context,
    }),
  );
  await appendUsage(root, { verb: "resolve", path, signature: sig });
  return { ok: true, path };
}

export async function runSearch(
  root: string,
  query: string,
  options: { home?: string } = {},
): Promise<{ hits: SearchHit[] }> {
  const cleaned = redact(clip(query, TEXT_LIMIT));
  const sig = signature(cleaned);
  await ensureStore(root);
  await appendUsage(root, { verb: "search", signature: sig });
  const hits = await searchMemoryFiles(root, cleaned, { home: options.home ?? userHome() });
  if (hits[0]) {
    await appendUsage(root, { verb: "hit", signature: sig, path: hits[0].path.replaceAll("\\", "/") });
  } else {
    await appendUsage(root, { verb: "miss", signature: sig });
  }
  return { hits };
}

function playbookRel(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function isProjectPlaybook(rel: string): boolean {
  return rel.startsWith(".burr/memory/playbooks/") && rel.endsWith(".md") && !rel.includes("..");
}

async function writePromotedPlaybook(
  home: string,
  preferredFilename: string,
  markdown: string,
): Promise<string> {
  const target = (filename: string) => join(home, ".burr", "memory", "playbooks", filename);
  const write = async (filename: string) => {
    const result = await writeIfMissing(home, target(filename), markdown);
    if (result === "created") return true;
    return (await readFile(target(filename), "utf8")) === markdown;
  };

  if (await write(preferredFilename)) return preferredFilename;

  const contentHash = signature(markdown).slice(-8);
  const stem = preferredFilename.replace(/\.md$/i, "").slice(0, 70).replace(/-+$/, "");
  const collisionFilename = `${stem || "playbook"}-${contentHash}.md`;
  if (await write(collisionFilename)) return collisionFilename;

  throw new Error(`Unable to promote playbook without overwriting ${collisionFilename}`);
}

async function newestLegacyPlaybook(root: string): Promise<string | undefined> {
  const dir = join(root, ".burr", "memory", "playbooks");
  let names: string[];
  try {
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) return undefined;
    names = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const candidates = await Promise.all(
    names.map(async (name) => ({
      name,
      mtimeMs: (await stat(join(dir, name))).mtimeMs,
    })),
  );
  const newest = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  return newest
    ? join(".burr", "memory", "playbooks", newest.name).replaceAll("\\", "/")
    : undefined;
}

async function legacyPlaybookExists(root: string, rel: string): Promise<boolean> {
  try {
    await readInside(root, join(root, rel));
    return true;
  } catch (error) {
    if (error instanceof BurrFsError || (error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function promotePlaybook(
  root: string,
  input: { path?: string; home?: string } = {},
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const home = input.home ?? userHome();
  await ensureStore(root);

  let rel = input.path ? playbookRel(input.path) : "";
  if (!rel) {
    const last = [...(await readUsage(root))]
      .reverse()
      .find(
        (event) =>
          event.verb === "resolve" &&
          event.path &&
          isProjectPlaybook(playbookRel(event.path)),
      );
    const ledgerRel = last?.path ? playbookRel(last.path) : "";
    rel =
      ledgerRel && (await legacyPlaybookExists(root, ledgerRel))
        ? ledgerRel
        : (await newestLegacyPlaybook(root)) ?? "";
  }
  if (!rel || !isProjectPlaybook(rel)) {
    await appendUsage(root, { verb: "discard", reason: rel ? "not-a-playbook" : "missing-playbook" });
    return { ok: false, reason: rel ? "not-a-playbook" : "missing-playbook" };
  }

  let markdown: string;
  try {
    markdown = await readInside(root, join(root, rel));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await appendUsage(root, { verb: "discard", reason: "missing-playbook" });
      return { ok: false, reason: "missing-playbook" };
    }
    if (error instanceof BurrFsError) {
      await appendUsage(root, { verb: "discard", reason: "not-a-playbook" });
      return { ok: false, reason: "not-a-playbook" };
    }
    throw error;
  }

  if (/^kind:\s*signal\s*$/m.test(markdown)) {
    await appendUsage(root, { verb: "discard", reason: "not-a-playbook" });
    return { ok: false, reason: "not-a-playbook" };
  }

  const filename = basename(rel);
  const cleaned = redact(markdown);
  await ensureUserMemory(home);
  const promotedFilename = await writePromotedPlaybook(home, filename, cleaned);
  const path = userMemoryRel("playbooks", promotedFilename);
  await appendUsage(root, {
    verb: "promote",
    path,
    signature: promotedFilename.replace(/\.md$/, ""),
  });
  return { ok: true, path };
}

export async function setMode(root: string, mode: Mode): Promise<void> {
  await ensureStore(root);
  const dest = join(root, ".burr", "config.json");
  let config: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readInside(root, dest)) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      config = parsed as Record<string, unknown>;
    }
  } catch {
    // Replace malformed config with the known-safe shape.
  }
  await writeInside(root, dest, `${JSON.stringify({ ...config, mode }, null, 2)}\n`);
}

export async function readMode(root: string): Promise<Mode> {
  try {
    const config = JSON.parse(await readInside(root, join(root, ".burr", "config.json"))) as {
      mode?: string;
    };
    if (config.mode === "on" || config.mode === "strict" || config.mode === "off") return config.mode;
  } catch {
    // default
  }
  return "on";
}

export async function status(root: string): Promise<{
  mode: Mode;
  playbooks: number;
  signals: number;
  lastHit?: { ts: string; path?: string };
}> {
  const count = async (dir: string) => {
    try {
      return (await readdir(dir)).filter((name) => name.endsWith(".md")).length;
    } catch {
      return 0;
    }
  };
  const summary = await summarizeUsage(root);
  return {
    mode: await readMode(root),
    playbooks:
      (await count(userPlaybooksDir())) + (await count(join(root, ".burr", "memory", "playbooks"))),
    signals: (await count(userSignalsDir())) + (await count(join(root, ".burr", "memory", "signals"))),
    lastHit: summary.lastHits[0]
      ? { ts: summary.lastHits[0].ts, path: summary.lastHits[0].path }
      : undefined,
  };
}
