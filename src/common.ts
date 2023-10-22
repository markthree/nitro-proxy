import type { ArgsDef } from "citty";

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
