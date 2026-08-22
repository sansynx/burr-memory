export type Mode = "on" | "strict" | "off";

export type Verb = "search" | "hit" | "miss" | "capture" | "resolve" | "discard";

export interface UsageEvent {
  ts: string;
  verb: Verb;
  signature?: string;
  path?: string;
  reason?: string;
}

export interface CaptureInput {
  title?: string;
  error: string;
  stack?: string;
  command?: string;
  exitCode?: number | string;
  attemptedFixes?: string[];
  context?: string;
  whyKeep?: string;
  rootCause?: string;
}

export interface ResolveInput {
  title?: string;
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
}

export interface SearchHit {
  path: string;
  score: number;
  excerpt: string;
}

export interface Admission {
  ok: boolean;
  reason?: string;
}

export interface UsageSummary {
  counts: Record<Verb, number>;
  lastHits: UsageEvent[];
  lastDiscards: UsageEvent[];
}
