import { $, execa } from "execa";
import { version } from "process";
import type { ArgsDef } from "citty";
import { logger } from "./logger";
import { green } from "kolorist";
import { dirname, resolve } from "pathe";
import { fileURLToPath } from "url";
import { isWindows } from "std-env";

export const commonArgs = <ArgsDef> {
  dir: {
    type: "string",
    description: "项目根目录",
  },
  _dir: {
    type: "positional",
    default: ".",
    description: "项目根目录 (prefer using `--dir`)",
  },
};

export function checkNodeVersion() {
  const major = Number(version.replace("v", "").split(".")[0]);
  if (major < 16) {
    logger.warn(
      "当前 node 版本小于 16，可能会照成超出预期的错误，请更新你的 node 版本",
    );
  }
  logger.success(`node → ${green(version)}`);
}

export function usePort(port: string) {
  if (isNaN(Number(port))) {
    throw new TypeError("服务端口号 port 必须是数字字符串");
  }
  return String(parseInt(port, 10));
}

const isWin = process.platform === "win32";
const REGEX = isWin ? /^(.*)\s+(\d+)\s*$/ : /^\s*(\d+)\s+(.*)/;

interface ProcessItem {
  pid: string;
  cmd: string;
}

type FilterFn = (item: ProcessItem) => boolean;

export async function findNodeProcess(filterFn: FilterFn) {
  const command = isWin
    ? "wmic Path win32_process Where \"Name = 'node.exe'\" Get CommandLine,ProcessId"
    // command, cmd are alias of args, not POSIX standard, so we use args
    : 'ps -wweo "pid,args"';
  const stdio = await $({ stdio: "pipe" })`${command}`;

  if (!stdio || !stdio.stdout) {
    return [];
  }
  const processList = stdio.stdout.toString().split("\n")
    .reduce((arr, line) => {
      if (!!line && !line.includes("/bin/sh") && line.includes("node")) {
        const m = line.match(REGEX);
        /* istanbul ignore else */
        if (m) {
          const item = isWin
            ? { pid: m[2], cmd: m[1] }
            : { pid: m[1], cmd: m[2] };
          if (!filterFn || filterFn(item)) {
            arr.push(item);
          }
        }
      }
      return arr;
    }, [] as ProcessItem[]);
  return processList;
}

export async function findNodeProcessWithTitle(title: string) {
  const reg = /--title=([^ ]*)( .*)*/;
  const list = await findNodeProcess((item) => {
    const [_, _title] = item.cmd.match(reg) ?? [];
    return _title?.trim() === title;
  });
  return list;
}

interface SilentExecaOptions {
  cwd?: string;
  file: string;
  commands?: string[];
}

export function silentExeca(options: SilentExecaOptions) {
  const { cwd = process.cwd(), file, commands = [] } = options;
  if (isWindows) {
    const scriptsDir = findScriptsDir();
    const cmd = resolve(scriptsDir, "cmd.mjs");
    const child_process = execa("node", [cmd, file, ...commands], {
      cwd,
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child_process.unref();
    return;
  }

  const child_process = execa(file, commands, {
    cwd,
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });

  child_process.unref();
  return;
}

export function findScriptsDir() {
  let _dirname = dirname(fileURLToPath(import.meta.url));
  while (!_dirname.endsWith("dist")) {
    _dirname = dirname(_dirname);
  }
  return _dirname;
}
