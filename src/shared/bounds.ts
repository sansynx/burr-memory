export const TEXT_LIMIT = 12_000;
export const SHORT_LIMIT = 240;
export const ATTEMPT_LIMIT = 2_000;
export const ATTEMPT_COUNT = 20;
export const DEP_COUNT = 50;
export const DEP_LIMIT = 120;

export function clip(text: string, limit = TEXT_LIMIT): string {
  return text.length <= limit ? text : text.slice(0, limit);
}
