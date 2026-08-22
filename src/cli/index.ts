#!/usr/bin/env node
import { resolve } from "node:path";
import { runInit } from "./init.js";
import { summarizeUsage } from "../shared/ledger.js";
import {
  captureSignal,
  readMode,
  resolvePlaybook,
  runSearch,
  setMode,
  status,
} from "../shared/memory.js";
import type { Mode } from "../shared/types.js";

const HELP = `Burr — local debugging memory for coding agents.

Usage:
  burr init [dir]              write .burr/ and host own-files
  burr [on|strict|off]         status, or set mode
  burr search <text>           search local memory
  burr capture --error <text>  save a redacted signal
  burr resolve --error <text> --cause <text> --fix <text> --verify <text>
  burr audit                   usage from usage.jsonl
  burr help                    this screen

Hosts: Claude Code /burr-search, Codex @burr-search, OpenCode /burr-search,
Pi /skill:burr-search. Cursor and Windsurf use the always-on rule only.
`;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function flags(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === `--${name}` && args[i + 1] && !args[i + 1]!.startsWith("--")) {
      values.push(args[i + 1]!);
      i += 1;
    }
  }
  return values;
}

function restAfter(args: string[], command: string): string {
  const index = args.indexOf(command);
  return args
    .slice(index + 1)
    .filter((item) => !item.startsWith("--"))
    .join(" ")
    .trim();
}

export async function main(argv: string[]): Promise<number> {
  const [command = "help", ...args] = argv;
  const cwd = command === "init" && args[0] && !args[0].startsWith("-") ? resolve(args[0]) : process.cwd();

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return 0;
  }

  if (command === "init") {
    await runInit(cwd, { log: (line) => console.log(line) });
    return 0;
  }

  if (command === "on" || command === "strict" || command === "off") {
    await setMode(cwd, command);
    console.log(`mode ${command}`);
    return 0;
  }

  if (command === "status" || command === undefined) {
    try {
      const current = await status(cwd);
      console.log(
        `mode ${current.mode} · ${current.playbooks} playbooks · ${current.signals} signals`,
      );
      if (current.lastHit) {
        console.log(`last hit ${current.lastHit.ts} ${current.lastHit.path ?? ""}`.trim());
      }
      return 0;
    } catch {
      console.log("Burr is not initialized. Run `npx burr init`.");
      return 1;
    }
  }

  if (command === "search") {
    const query = restAfter(argv, "search") || flag(args, "query") || "";
    if (!query) {
      console.error("burr search <text>");
      return 1;
    }
    const { hits } = await runSearch(cwd, query);
    if (!hits.length) {
      console.log("miss");
      return 0;
    }
    for (const hit of hits) {
      console.log(`${hit.path}\n  ${hit.excerpt}\n`);
    }
    return 0;
  }

  if (command === "capture") {
    const error = flag(args, "error") || restAfter(argv, "capture");
    if (!error) {
      console.error("burr capture --error <text>");
      return 1;
    }
    const result = await captureSignal(cwd, {
      error,
      stack: flag(args, "stack"),
      command: flag(args, "command"),
      exitCode: flag(args, "exit") ?? flag(args, "exit-code"),
      attemptedFixes: flags(args, "attempt"),
      whyKeep: flag(args, "why"),
      title: flag(args, "title"),
    });
    if (!result.ok) {
      console.log(`discard ${result.reason}`);
      return 0;
    }
    console.log(result.path);
    return 0;
  }

  if (command === "resolve") {
    const error = flag(args, "error");
    const rootCause = flag(args, "cause") ?? flag(args, "root-cause");
    const fix = flag(args, "fix");
    const verification = flag(args, "verify") ?? flag(args, "verification");
    if (!error || !rootCause || !fix || !verification) {
      console.error("burr resolve --error <text> --cause <text> --fix <text> --verify <text>");
      return 1;
    }
    const result = await resolvePlaybook(cwd, {
      error,
      rootCause,
      fix,
      verification,
      failedAttempts: flags(args, "attempt"),
      title: flag(args, "title"),
      context: {
        language: flag(args, "language"),
        framework: flag(args, "framework"),
        risk: flag(args, "risk"),
        confidence: flag(args, "confidence"),
      },
    });
    if (!result.ok) {
      console.log(`discard ${result.reason}`);
      return 0;
    }
    console.log(result.path);
    return 0;
  }

  if (command === "audit") {
    const summary = await summarizeUsage(cwd);
    const total = Object.values(summary.counts).reduce((sum, n) => sum + n, 0);
    if (total === 0) {
      console.log("Burr has no usage yet.");
      return 0;
    }
    console.log(
      Object.entries(summary.counts)
        .map(([verb, count]) => `${verb} ${count}`)
        .join(" · "),
    );
    for (const hit of summary.lastHits) {
      console.log(`hit ${hit.ts} ${hit.path ?? ""}`.trim());
    }
    for (const discard of summary.lastDiscards) {
      console.log(`discard ${discard.ts} ${discard.reason ?? ""}`.trim());
    }
    return 0;
  }

  if (command === "mode") {
    const next = args[0];
    if (next === "on" || next === "strict" || next === "off") {
      await setMode(cwd, next as Mode);
      console.log(`mode ${next}`);
      return 0;
    }
    console.log(`mode ${await readMode(cwd)}`);
    return 0;
  }

  console.log(HELP);
  return command ? 1 : 0;
}

const invoked = process.argv[1]?.replaceAll("\\", "/");
if (invoked && /(?:^|\/)(?:index|cli)(?:\.(?:js|ts))?$/.test(invoked) && !process.env.VITEST) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
