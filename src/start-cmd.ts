import { execa } from "execa";
import { resolve } from "pathe";
import { green } from "kolorist";
import { silentExeca } from "./common";
import { defineCommand } from "citty";
import { logger as _logger } from "./logger";

const logger = _logger.withTag("start-cmd");

export default defineCommand({
  meta: {
    name: "start",
    description: "从命令中启动",
  },
  args: {
    commands: {
      type: "string",
      required: true,
      description: "命令",
    },
    silent: {
      type: "boolean",
      required: false,
      default: false,
      description: "后台运行",
    },
  },
  async run({ args }) {
    // 解析 vite 配置
    const cwd = resolve((args.dir || args._dir || ".") as string);
    logger.success(`cwd → ${green(cwd)}`);
    const commands = args.commands.split(",") || [];

    const file = commands.shift()!;
    if (args.silent) {
      silentExeca({ cwd, file, commands });
    } else {
      await execa(file, commands, {
        cwd,
        stdio: "inherit",
      });
    }

    process.exit(0);
  },
});
