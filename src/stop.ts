import { defineCommand } from "citty";
import runscript from "runscript";
import fkill from "fkill";
import { logger } from "./logger";

const isWin = process.platform === "win32";
const REGEX = isWin ? /^(.*)\s+(\d+)\s*$/ : /^\s*(\d+)\s+(.*)/;

interface ProcessItem {
  pid: string;
  cmd: string;
}

type FilterFn = (item: ProcessItem) => boolean;

async function findNodeProcess(filterFn: FilterFn) {
  const command = isWin
    ? "wmic Path win32_process Where \"Name = 'node.exe'\" Get CommandLine,ProcessId"
    // command, cmd are alias of args, not POSIX standard, so we use args
    : 'ps -wweo "pid,args"';
  const stdio = await runscript(command, { stdio: "pipe" });
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

export default defineCommand({
  meta: {
    name: "stop",
    description: "终止 nitro-proxy 进程",
  },
  args: {
    port: {
      type: "string",
      required: false,
      description: "通过服务端口终止",
    },
    pid: {
      type: "string",
      required: false,
      description: "通过进程 ID 终止",
    },
    title: {
      type: "string",
      default: "nitro-proxy",
      description: "通过终端名终止",
    },
  },
  async run({ args }) {
    if (args.title) {
      const list = await findNodeProcess((item) => {
        const [_, title] = item.cmd.match(/--title=(\w+)/) ?? [];
        return title?.trim() === args.title;
      });

      if (list.length === 0) {
        logger.error(`通过终端名没有找到任何进程 title → ${args.title}`);
        return;
      }

      await fkill(list.map((item) => Number(item.pid)), { force: true }).catch(
        (res) => {
          logger.error(`通过终端名终止失败 title → ${args.title}`);
          logger.error(res);
        },
      );
      return;
    }

    if (args.pid) {
      await fkill(args.pid, { force: true }).catch((res) => {
        logger.error(`通过进程 ID 终止 pid → ${args.pid}`);
        logger.error(res);
      });
      return;
    }

    if (args.port) {
      await fkill(`:${args.port}`, { force: true }).catch((res) => {
        logger.error(`通过服务端口终止失败 port → ${args.port}`);
        logger.error(res);
      });
      return;
    }

    logger.error("没有任何参数可用");
  },
});
