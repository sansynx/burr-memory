import { TEXT_LIMIT, clip } from "./bounds.js";

const PATTERNS: Array<[RegExp, string]> = [
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    "[REDACTED]",
  ],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED]"],
  [
    /\b(?:sk-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,})\b/g,
    "[REDACTED]",
  ],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._\-+=/]{16,}\b/gi, "Bearer [REDACTED]"],
  [
    /\b(api[_-]?key|secret|password|passwd|token|authorization)\s*[:=]\s*['"]?[^'"\s]{4,}/gi,
    "$1=[REDACTED]",
  ],
  [
    /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*[:=]\s*['"]?[^'"\s]+/g,
    "[REDACTED]",
  ],
  [/([?&](?:token|key|secret|password|access_token|api_key|auth)=)[^&\s]+/gi, "$1[REDACTED]"],
  [/\/\/([^/@\s]+):([^@/\s]+)@/g, "//$1:[REDACTED]@"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]"],
  [/(\/Users\/)[^/\s"'`]+/g, "$1[HOME]"],
  [/(\/home\/)[^/\s"'`]+/g, "$1[HOME]"],
  [/([A-Za-z]:[/\\]Users[/\\])[^/\\\s"'`]+/gi, "$1[HOME]"],
  [/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[IP]"],
  [/\b192\.168\.\d{1,3}\.\d{1,3}\b/g, "[IP]"],
  [/\b172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}\b/g, "[IP]"],
];

export function redactUnbounded(text: string): string {
  let next = String(text ?? "");
  if (!next) return "";
  for (const [pattern, replacement] of PATTERNS) {
    pattern.lastIndex = 0;
    next = next.replace(pattern, replacement);
  }
  return next;
}

export function redact(text: string): string {
  return clip(redactUnbounded(text), TEXT_LIMIT);
}
