import { createHash } from "node:crypto";
import { redact } from "./redaction.js";
import { tokenize } from "./tokens.js";

export function signature(error: string): string {
  const redacted = redact(error);
  const normalized = redacted.toLowerCase().replace(/\s+/g, " ").trim();
  const tokens = tokenize(normalized)
    .filter((token) => token.length >= 3)
    .slice(0, 6);
  const slug = (tokens.join("-") || "error").replace(/[^a-z0-9-]/g, "");
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  return `${slug}-${hash}`.slice(0, 80).replace(/-+$/, "");
}

export function renderPlaybook(input: {
  title: string;
  signature: string;
  error: string;
  rootCause: string;
  fix: string;
  failedAttempts?: string[];
  verification: string;
  context?: {
    language?: string;
    framework?: string;
    risk?: string;
    confidence?: string;
  };
}): string {
  const attempts = (input.failedAttempts ?? []).filter(Boolean);
  const context = input.context ?? {};
  return `---
title: ${input.title}
signature: ${input.signature}
kind: playbook
---

# ${input.title}

## Error

${input.error}

## Root Cause

${input.rootCause}

## Fix

${input.fix}

## Failed Attempts

${attempts.length ? attempts.map((item) => `- ${item}`).join("\n") : "- none recorded"}

## Verification

${input.verification}

## Context

Language / Framework / Risk / Confidence
${context.language ?? "—"} / ${context.framework ?? "—"} / ${context.risk ?? "—"} / ${context.confidence ?? "—"}
`;
}

export function renderSignal(input: {
  title: string;
  signature: string;
  error: string;
  stack?: string;
  command?: string;
  exitCode?: number | string;
  attemptedFixes?: string[];
  whyKeep?: string;
}): string {
  const attempts = (input.attemptedFixes ?? []).filter(Boolean);
  return `---
title: ${input.title}
signature: ${input.signature}
kind: signal
---

# ${input.title}

- Signature: \`${input.signature}\`
- Command: ${input.command ?? "—"}
- Exit: ${input.exitCode ?? "—"}

## Error

${input.error}

## Stack

${input.stack ?? "—"}

## Attempted Fixes

${attempts.length ? attempts.map((item) => `- ${item}`).join("\n") : "- none recorded"}

## Why keep

${input.whyKeep ?? "Reusable beyond this machine and this moment."}
`;
}
