export const TEXT_LIMIT = 12_000;
export const SHORT_LIMIT = 240;
export const ATTEMPT_LIMIT = 2_000;
export const ATTEMPT_COUNT = 20;

export function clip(text: string, limit = TEXT_LIMIT): string {
  if (!text) return "";
  return text.length <= limit ? text : text.slice(0, limit);
}
