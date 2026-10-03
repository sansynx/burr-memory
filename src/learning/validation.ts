import type {
  CandidateLesson,
  MemoryItem,
  MemoryScope,
} from "../shared/types.js";

const scopeFields = [
  "level",
  "repository",
  "language",
  "framework",
  "package",
  "packageVersion",
  "tool",
] as const;
const scopeLevels = [
  "global",
  "ecosystem",
  "repository",
  "tool",
  "package",
  "framework",
];
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): boolean =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");
const optionalStrings = (value: unknown): boolean =>
  value === undefined || strings(value);
const count = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const date = (value: unknown): boolean =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const optionalString = (value: unknown): boolean =>
  value === undefined || typeof value === "string";

export function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
}

function validScope(value: unknown): boolean {
  return (
    record(value) &&
    scopeLevels.includes(String(value.level)) &&
    scopeFields.every((key) => optionalString(value[key]))
  );
}

export function scopeKey(scope: MemoryScope): string {
  return JSON.stringify(scopeFields.map((field) => scope[field] ?? ""));
}

function validVerification(value: unknown): boolean {
  return (
    value === undefined ||
    (record(value) &&
      optionalString(value.command) &&
      optionalString(value.result))
  );
}

export function validCandidate(value: unknown): value is CandidateLesson {
  if (!record(value) || !record(value.evidence)) return false;
  if (
    value.playbook !== undefined &&
    (!record(value.playbook) ||
      !["problem", "rootCause", "fix"].every(
        (key) =>
          typeof (value.playbook as Record<string, unknown>)[key] === "string",
      ) ||
      !validVerification(value.playbook.verification))
  )
    return false;
  return (
    validId(value.id) &&
    ["repository-rule", "tool-strategy", "avoid", "playbook"].includes(
      String(value.type),
    ) &&
    typeof value.statement === "string" &&
    validScope(value.scope) &&
    typeof value.evidence.sessionId === "string" &&
    count(value.evidence.observedCount) &&
    (value.evidence.verified === undefined ||
      typeof value.evidence.verified === "boolean") &&
    optionalStrings(value.evidence.toolCalls) &&
    optionalString(value.evidence.verificationCommand) &&
    count(value.confidence) &&
    Number(value.confidence) <= 1 &&
    date(value.createdAt) &&
    ["candidate", "admitted", "rejected", "merged"].includes(
      String(value.status),
    )
  );
}

export function validMemory(value: unknown): value is MemoryItem {
  if (!record(value) || !record(value.evidence)) return false;
  if (!validVerification(value.verification)) return false;
  if (
    value.toolStrategy !== undefined &&
    (!record(value.toolStrategy) ||
      !optionalStrings(value.toolStrategy.useful) ||
      !optionalStrings(value.toolStrategy.wasteful))
  )
    return false;
  return (
    validId(value.id) &&
    typeof value.title === "string" &&
    ["knowledge", "playbook", "tool-strategy"].includes(String(value.type)) &&
    validScope(value.scope) &&
    [
      "statement",
      "problem",
      "rootCause",
      "fix",
      "escapeStrategy",
      "markdown",
      "errorSignature",
    ].every((key) => optionalString(value[key])) &&
    optionalStrings(value.appliedCandidates) &&
    optionalStrings(value.failedPaths) &&
    count(value.evidence.observed) &&
    count(value.evidence.successfulReuse) &&
    count(value.evidence.failedReuse) &&
    (value.evidence.lastUsed === undefined || date(value.evidence.lastUsed)) &&
    optionalStrings(value.evidence.sessionIds) &&
    count(value.confidence) &&
    Number(value.confidence) <= 1 &&
    date(value.createdAt) &&
    date(value.updatedAt) &&
    ["active", "stale", "archived"].includes(String(value.status))
  );
}
