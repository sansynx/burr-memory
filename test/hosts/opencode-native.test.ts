import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { runInit } from "../../src/cli/init.js";
import { runGlobal } from "../../src/cli/global.js";
import { SKILL_NAMES, withTempDir } from "../helpers.js";

// Point BURR_OPENCODE_CLI at an installed executable. All host data is temporary.
it.skipIf(!process.env.BURR_OPENCODE_CLI)(
  "OpenCode discovers Burr's generated config and commands",
  async () => {
    await withTempDir(async (root) => {
      const project = join(root, "project");
      const home = join(root, "home");
      await mkdir(project);
      await mkdir(home);
      await promisify(execFile)("git", ["init", "--quiet", project], {
        windowsHide: true,
      });
      await runInit(project);
      await writeFile(join(project, ".burr", "config.json"), '{"mode":"off"}');
      const env: NodeJS.ProcessEnv = {};
      for (const name of [
        "PATH",
        "Path",
        "SystemRoot",
        "SYSTEMROOT",
        "COMSPEC",
        "PATHEXT",
        "WINDIR",
      ]) {
        if (process.env[name]) env[name] = process.env[name];
      }
      Object.assign(env, {
        HOME: home,
        USERPROFILE: home,
        BURR_HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_DATA_HOME: join(home, "data"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_STATE_HOME: join(home, "state"),
        TEMP: home,
        TMP: home,
        OPENCODE_TEST_HOME: home,
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_MODELS_FETCH: "1",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
        OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
        npm_config_registry: "http://127.0.0.1:9",
        npm_config_offline: "true",
        npm_config_fetch_retries: "0",
        HTTP_PROXY: "http://127.0.0.1:9",
        HTTPS_PROXY: "http://127.0.0.1:9",
      });
      const { stdout, stderr } = await promisify(execFile)(
        process.env.BURR_OPENCODE_CLI!,
        ["debug", "config", "--print-logs", "--log-level", "DEBUG"],
        {
          cwd: project,
          env,
          windowsHide: true,
          timeout: 60000,
          maxBuffer: 4 * 1024 * 1024,
        },
      ).catch((error) => {
        throw new Error(
          `${error.message}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`,
        );
      });
      const config = JSON.parse(stdout);
      for (const name of SKILL_NAMES)
        expect(config.command, stderr).toHaveProperty(name);
      expect(JSON.stringify(config.plugin)).not.toContain(
        ".opencode/.opencode",
      );
      await runGlobal({ home });
      const globalProject = join(root, "global-project");
      await mkdir(globalProject);
      await promisify(execFile)("git", ["init", "--quiet", globalProject], {
        windowsHide: true,
      });
      const globalResult = await promisify(execFile)(
        process.env.BURR_OPENCODE_CLI!,
        ["debug", "config"],
        {
          cwd: globalProject,
          env,
          windowsHide: true,
          timeout: 30000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      const globalConfig = JSON.parse(globalResult.stdout);
      for (const name of SKILL_NAMES)
        expect(globalConfig.command, globalResult.stderr).toHaveProperty(name);
    });
  },
  90000,
);
