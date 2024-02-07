import fkill from "fkill";
import runscript from "runscript";
import { logger } from "./logger";
import { defineCommand } from "citty";

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
    tree: {
      type: "boolean",
      default: true,
      description: "终止进程树",
    },
  },
  async run({ args }) {
    if (args.port) {
      try {
        await fkill(`:${args.port}`, { force: true, tree: args.tree });
        logger.success(`通过服务端口终止成功 port → ${args.port}`);
      } catch (error) {
        logger.error(`通过服务端口终止失败 port → ${args.port}`);
        logger.error(error);
      } finally {
        process.exit(0);
      }
    }

    if (args.pid) {
      try {
        await fkill(`:${args.port}`, { force: true, tree: args.tree });
        logger.success(`通过进程 ID 终止成功 pid → ${args.pid}`);
      } catch (error) {
        logger.error(`通过进程 ID 终止 pid → ${args.pid}`);
        logger.error(error);
      } finally {
        process.exit(0);
      }
    }

    if (args.title) {
      try {
        const list = await findNodeProcess((item) => {
          const [_, title] = item.cmd.match(/--title=([^ ]*)( .*)*/) ?? [];
          return title?.trim() === args.title;
        });
        if (list.length === 0) {
          throw `通过终端名没有找到任何进程 title → ${args.title}`;
        }

        if (args.tree) {
          list.length = 1;
        }

        await fkill(list.map((item) => Number(item.pid)), {
          force: true,
          tree: args.tree,
        });
        logger.success(`通过终端名终止成功 title → ${args.title}`);
      } catch (error) {
        logger.error(`通过终端名终止失败 title → ${args.title}`);
        logger.error(error);
      } finally {
        process.exit(0);
      }
    }
    logger.error("无任何参数可用");
    process.exit(0);
  },
});
