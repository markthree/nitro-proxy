import { findNodeProcessWithTitle } from "./common";
import { pidToPorts, portToPid } from "pid-port";
import { logger as _logger } from "./logger";
import { defineCommand } from "citty";

const logger = _logger.withTag("find");

export default defineCommand({
  meta: {
    name: "find",
    description: "找到正在运行的进程",
  },
  args: {
    port: {
      type: "string",
      required: false,
      description: "通过服务端口",
    },
    pid: {
      type: "string",
      required: false,
      description: "通过进程 ID ",
    },
    title: {
      type: "string",
      default: "nitro-proxy",
      description: "通过终端名",
    },
  },
  async run({ args }) {
    if (args.port) {
      try {
        await portToPid(parseInt(args.port));
        logger.success(`通过服务端口获取成功 port → ${args.port}`);
      } catch (error) {
        logger.error(`通过服务端口获取失败 port → ${args.port}`);
        logger.error(error);
      } finally {
        process.exit(0);
      }
    }

    if (args.pid) {
      try {
        await pidToPorts(parseInt(args.pid));
        logger.success(`通过进程 ID 获取成功 pid → ${args.pid}`);
      } catch (error) {
        logger.error(`通过进程 ID 获取失败 pid → ${args.pid}`);
        logger.error(error);
      } finally {
        process.exit(0);
      }
    }

    if (args.title) {
      try {
        const list = await findNodeProcessWithTitle(args.title);
        if (list.length === 0) {
          throw `通过终端名没有找到任何进程 title → ${args.title}`;
        }
        logger.success(
          `通过终端名获取成功 title → ${args.title}`,
        );
      } catch (error) {
        logger.error(`通过终端名获取失败 → ${args.title}`);
        logger.error(error);
      } finally {
        process.exit(0);
      }
    }
    logger.error("无任何参数可用");
    process.exit(0);
  },
});
