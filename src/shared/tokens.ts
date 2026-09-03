const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "is",
  "it",
  "this",
  "that",
  "with",
  "from",
  "at",
  "by",
  "as",
  "be",
  "was",
  "are",
  "were",
  "not",
  "no",
  "yes",
]);

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((token) => token.length >= 2 && !STOP.has(token));
}
