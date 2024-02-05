import { version } from "process";
import type { ArgsDef } from "citty";
import { logger } from "./logger";
import { green } from "kolorist";

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
