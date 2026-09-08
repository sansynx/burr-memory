import { join } from "node:path";
import { ensureStore } from "./ensure-store.js";
import { readInside, writeInside } from "./fs.js";
import type { BurrConfig, MemoryConfig, Mode, RuntimeConfig } from "./types.js";

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  enabled: true,
  warnScore: 50,
  blockScore: 70,
  fuzzyThreshold: 0.85,
  recentWindow: 20,
};

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  maxRetrieved: 5,
  runRetentionDays: 7,
  maxCandidates: 100,
  archiveAfterDays: 60,
};

export const DEFAULT_CONFIG: BurrConfig = {
  mode: "on",
  runtime: DEFAULT_RUNTIME_CONFIG,
  memory: DEFAULT_MEMORY_CONFIG,
};

function parseMode(val: unknown): Mode {
  return val === "strict" || val === "off" || val === "on" ? val : "on";
}

function parseNumber(
  val: unknown,
  fallback: number,
  min = 0,
  max = Infinity,
): number {
  if (
    typeof val === "number" &&
    !Number.isNaN(val) &&
    val >= min &&
    val <= max
  ) {
    return val;
  }
  return fallback;
}

export async function loadConfig(root: string): Promise<BurrConfig> {
  const dest = join(root, ".burr", "config.json");
  try {
    const raw = await readInside(root, dest);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_CONFIG };
    }

    const mode = parseMode(parsed.mode);
    const runtimeRaw = (
      parsed.runtime && typeof parsed.runtime === "object" ? parsed.runtime : {}
    ) as Record<string, unknown>;
    const memoryRaw = (
      parsed.memory && typeof parsed.memory === "object" ? parsed.memory : {}
    ) as Record<string, unknown>;

    const runtime: RuntimeConfig = {
      enabled:
        typeof runtimeRaw.enabled === "boolean"
          ? runtimeRaw.enabled
          : DEFAULT_RUNTIME_CONFIG.enabled,
      warnScore: parseNumber(
        runtimeRaw.warnScore,
        DEFAULT_RUNTIME_CONFIG.warnScore,
        0,
        100,
      ),
      blockScore: parseNumber(
        runtimeRaw.blockScore,
        DEFAULT_RUNTIME_CONFIG.blockScore,
        0,
        100,
      ),
      fuzzyThreshold: parseNumber(
        runtimeRaw.fuzzyThreshold,
        DEFAULT_RUNTIME_CONFIG.fuzzyThreshold,
        0,
        1,
      ),
      recentWindow: parseNumber(
        runtimeRaw.recentWindow,
        DEFAULT_RUNTIME_CONFIG.recentWindow,
        1,
        100,
      ),
    };

    const memory: MemoryConfig = {
      maxRetrieved: parseNumber(
        memoryRaw.maxRetrieved,
        DEFAULT_MEMORY_CONFIG.maxRetrieved,
        1,
        20,
      ),
      runRetentionDays: parseNumber(
        memoryRaw.runRetentionDays,
        DEFAULT_MEMORY_CONFIG.runRetentionDays,
        1,
        365,
      ),
      maxCandidates: parseNumber(
        Number.isInteger(memoryRaw.maxCandidates)
          ? memoryRaw.maxCandidates
          : undefined,
        DEFAULT_MEMORY_CONFIG.maxCandidates,
        1,
        1000,
      ),
      archiveAfterDays: parseNumber(
        memoryRaw.archiveAfterDays,
        DEFAULT_MEMORY_CONFIG.archiveAfterDays,
        1,
        365,
      ),
    };

    return { mode, runtime, memory };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(
  root: string,
  partial: Partial<BurrConfig>,
): Promise<BurrConfig> {
  await ensureStore(root);
  const current = await loadConfig(root);
  const dest = join(root, ".burr", "config.json");

  let existingRaw: Record<string, unknown> = {};
  try {
    const raw = await readInside(root, dest);
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (k !== "__proto__" && k !== "constructor" && k !== "prototype") {
          existingRaw[k] = v;
        }
      }
    }
  } catch {
    // fallback
  }

  const merged: BurrConfig = {
    mode: partial.mode ?? current.mode,
    runtime: {
      ...current.runtime,
      ...(partial.runtime ?? {}),
    },
    memory: {
      ...current.memory,
      ...(partial.memory ?? {}),
    },
  };

  const toWrite = {
    ...existingRaw,
    mode: merged.mode,
    runtime: merged.runtime,
    memory: merged.memory,
  };

  await writeInside(root, dest, `${JSON.stringify(toWrite, null, 2)}\n`);
  return merged;
}
