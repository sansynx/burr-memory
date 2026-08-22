import type { Admission, CaptureInput, ResolveInput } from "./types.js";

const DISCARD: Array<{ reason: string; re: RegExp }> = [
  { reason: "port-in-use", re: /EADDRINUSE|address already in use|port \d+\s+.*in use/i },
  {
    reason: "dev-server-down",
    re: /ECONNREFUSED.*(?:localhost|127\.0\.0\.1)|connect ECONNREFUSED|dev server (?:is )?(?:not running|isn't running)/i,
  },
  {
    reason: "missing-local-asset",
    re: /(?:ENOENT|no such file or directory).*\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|css|html)\b/i,
  },
  {
    reason: "unset-local-env",
    re: /(?:environment variable|env(?:ironment)? var(?:iable)?)\s+\S+\s+(?:is )?(?:not set|undefined|missing)|process\.env\.\w+\s+is\s+(?:undefined|not set)/i,
  },
  {
    reason: "flaky-network",
    re: /ETIMEDOUT|ENETUNREACH|EAI_AGAIN|network (?:is )?(?:unreachable|timed? ?out)|temporarily unavailable/i,
  },
];

const KEEP =
  /TypeError|ReferenceError|SyntaxError|RangeError|ZodError|TS\d{3,5}|cannot find module ['"][a-z0-9@/~_-]+['"]|(?:wrong\s+)?API\s+(?:error|response|schema|contract|key|shape)|schema|validation|unauthorized|hydrat|cors|csrf|misconfigured|library misuse|incorrect usage|wrong (?:type|config|endpoint)/i;

function haystack(input: { error?: string; rootCause?: string; stack?: string }): string {
  return [input.error, input.rootCause, input.stack].filter(Boolean).join("\n");
}

function discardReason(text: string): string | undefined {
  return DISCARD.find((rule) => rule.re.test(text))?.reason;
}

function isRealVerification(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (
    /^(?:fixed|done|ok|works(?: now)?|i think(?: it'?s)? fixed|should work(?: now)?)\.?$/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  return (
    /\b(npm test|pnpm test|yarn test|vitest|pytest|cargo test|go test|jest)\b/i.test(trimmed) ||
    /\b(\d+ passed|0 fail|all tests pass|tests? pass)/i.test(trimmed) ||
    (/\breproduced\b/i.test(trimmed) && /\b(gone|no longer|fixed|disappear)/i.test(trimmed)) ||
    /\b(measured|benchmark|timing|before\/after)\b/i.test(trimmed) ||
    /\bexit(?:ed)?(?: code)? 0\b/i.test(trimmed)
  );
}

export function admitSignal(input: Pick<CaptureInput, "error" | "rootCause" | "stack">): Admission {
  const text = haystack(input);
  const reason = discardReason(text);
  if (reason && KEEP.test(text)) return { ok: true };
  if (reason) return { ok: false, reason };
  return { ok: true };
}

export function admitResolution(input: ResolveInput): Admission {
  if (!isRealVerification(input.verification ?? "")) {
    return { ok: false, reason: "missing-verification" };
  }
  return admitSignal(input);
}
