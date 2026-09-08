import type { BurrHarnessCapabilities } from "../shared/types.js";

// Capabilities of the shipped adapters when loaded by their host.
export const HARNESS_CAPABILITIES: Record<string, BurrHarnessCapabilities> = {
  codex: {
    name: "OpenAI Codex",
    beforeToolObservation: false,
    afterToolObservation: false,
    blocking: false,
    contextInjection: true,
  },
  "claude-code": {
    name: "Claude Code",
    beforeToolObservation: false,
    afterToolObservation: false,
    blocking: false,
    contextInjection: true,
  },
  opencode: {
    name: "OpenCode",
    beforeToolObservation: true,
    afterToolObservation: true,
    blocking: true,
    contextInjection: true,
  },
  cursor: {
    name: "Cursor",
    beforeToolObservation: false,
    afterToolObservation: false,
    blocking: false,
    contextInjection: true,
  },
  pi: {
    name: "Pi",
    beforeToolObservation: true,
    afterToolObservation: true,
    blocking: true,
    contextInjection: true,
  },
};

export function getHarnessCapabilities(
  harness: string,
): BurrHarnessCapabilities {
  const key = harness.toLowerCase().trim();
  return (
    HARNESS_CAPABILITIES[key] ?? {
      name: harness,
      beforeToolObservation: false,
      afterToolObservation: false,
      blocking: false,
      contextInjection: false,
    }
  );
}
