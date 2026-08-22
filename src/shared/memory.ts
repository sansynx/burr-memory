import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { admitResolution, admitSignal } from "./admission.js";
import { ATTEMPT_COUNT, ATTEMPT_LIMIT, SHORT_LIMIT, TEXT_LIMIT, clip } from "./bounds.js";
import { writeInside } from "./fs.js";
import { appendUsage, summarizeUsage } from "./ledger.js";
import { renderPlaybook, renderSignal, signature } from "./playbook.js";
import { redact } from "./redaction.js";
import { searchMemoryFiles } from "./search.js";
import type { CaptureInput, Mode, ResolveInput, SearchHit } from "./types.js";

function boundList(items: string[] | undefined, count: number, limit: number): string[] {
  return (items ?? []).slice(0, count).map((item) => clip(item, limit));
}

function titleFrom(error: string, fallback: string): string {
  const line = clip(error.split(/\r?\n/)[0] ?? fallback, SHORT_LIMIT);
  return line || fallback;
}

export async function captureSignal(
  root: string,
  input: CaptureInput,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const bounded: CaptureInput = {
    ...input,
    error: clip(input.error ?? "", TEXT_LIMIT),
    stack: input.stack ? clip(input.stack, TEXT_LIMIT) : undefined,
    command: input.command ? clip(input.command, SHORT_LIMIT) : undefined,
    attemptedFixes: boundList(input.attemptedFixes, ATTEMPT_COUNT, ATTEMPT_LIMIT),
    whyKeep: input.whyKeep ? clip(input.whyKeep, TEXT_LIMIT) : undefined,
    rootCause: input.rootCause ? clip(input.rootCause, TEXT_LIMIT) : undefined,
  };
  const sig = signature(bounded.error);
  const admission = admitSignal(bounded);
  if (!admission.ok) {
    await appendUsage(root, { verb: "discard", reason: admission.reason, signature: sig });
    await mkdir(join(root, ".burr", "memory", "signals"), { recursive: true });
    return { ok: false, reason: admission.reason ?? "discard" };
  }

  const path = join(".burr", "memory", "signals", `${sig}.md`).replaceAll("\\", "/");
  await writeInside(
    root,
    path,
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
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const bounded: ResolveInput = {
    ...input,
    error: clip(input.error ?? "", TEXT_LIMIT),
    rootCause: clip(input.rootCause ?? "", TEXT_LIMIT),
    fix: clip(input.fix ?? "", TEXT_LIMIT),
    verification: clip(input.verification ?? "", TEXT_LIMIT),
    failedAttempts: boundList(input.failedAttempts, ATTEMPT_COUNT, ATTEMPT_LIMIT),
  };
  const sig = signature(bounded.error);
  const admission = admitResolution(bounded);
  if (!admission.ok) {
    await appendUsage(root, { verb: "discard", reason: admission.reason, signature: sig });
    return { ok: false, reason: admission.reason ?? "discard" };
  }

  const path = join(".burr", "memory", "playbooks", `${sig}.md`).replaceAll("\\", "/");
  await writeInside(
    root,
    path,
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
): Promise<{ hits: SearchHit[] }> {
  const cleaned = redact(clip(query, TEXT_LIMIT));
  const sig = signature(cleaned);
  await appendUsage(root, { verb: "search", signature: sig });
  const hits = await searchMemoryFiles(root, cleaned);
  if (hits[0]) {
    await appendUsage(root, { verb: "hit", signature: sig, path: hits[0].path.replaceAll("\\", "/") });
  } else {
    await appendUsage(root, { verb: "miss", signature: sig });
  }
  return { hits };
}

export async function setMode(root: string, mode: Mode): Promise<void> {
  const dest = join(root, ".burr", "config.json");
  await mkdir(join(root, ".burr"), { recursive: true });
  await writeFile(dest, `${JSON.stringify({ mode }, null, 2)}\n`);
}

export async function readMode(root: string): Promise<Mode> {
  try {
    const { readFile } = await import("node:fs/promises");
    const config = JSON.parse(await readFile(join(root, ".burr", "config.json"), "utf8")) as {
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
  const { readdir } = await import("node:fs/promises");
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
    playbooks: await count(join(root, ".burr", "memory", "playbooks")),
    signals: await count(join(root, ".burr", "memory", "signals")),
    lastHit: summary.lastHits[0]
      ? { ts: summary.lastHits[0].ts, path: summary.lastHits[0].path }
      : undefined,
  };
}
