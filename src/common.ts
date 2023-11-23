import { version } from "process";
import type { ArgsDef } from "citty";
import { logger } from "./logger";

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
  logger.success(`当前 node 版本 → ${version}`);
}
