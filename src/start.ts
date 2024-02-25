import { defineCommand } from "citty";
import { execa } from "execa";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { dirname, resolve } from "pathe";
import { logger as _logger } from "./logger";
import { green, red } from "kolorist";
import { usePort } from "./common";

const logger = _logger.withTag("start");

export default defineCommand({
  meta: {
    name: "start",
    description: "从 .output 中启动",
  },
  args: {
    port: {
      type: "string",
      required: false,
      description: "服务端口",
    },
    silent: {
      type: "boolean",
      required: false,
      default: false,
      description: "后台运行",
    },
  },
  async run({ args }) {
    if (args.port !== undefined) {
      // 覆盖端口
      overwritePort(args.port);
    }

    // 搜索 metaFile
    const metaFile = findNitroMetaJson();

    // 解析 preview 命令
    const metaJson = await resolveMetaFile(metaFile);

    if (!metaJson.commands?.preview) {
      throw new Error(`不存在 commands.preview 命令 → ${red(metaFile)}`);
    }

    const cwd = dirname(metaFile);
    const { preview } = metaJson.commands;
    logger.success(`cwd → ${green(cwd)}`);
    logger.success(`执行 preview 命令 → ${green(preview)}`);
    const [runtime, ...commands] = preview.split(" ");
    // 添加 title 标记，后续终止时需要用到
    commands.push("--title=nitro-proxy");
    await execa(runtime, commands, {
      cwd,
      detached: args.silent,
      stdio: args.silent ? "ignore" : "inherit",
    });
    console.log();
    logger.success(`服务地址 → http://localhost:${process.env.NITRO_PORT}`);

    process.exit(0);
  },
});

/**
 * 重写端口
 */
function overwritePort(port: string) {
  process.env.NITRO_PORT = usePort(port);
  logger.success(`服务端口 → ${green(process.env.NITRO_PORT)}`);
}

function findNitroMetaJson() {
  const metaFile = "nitro.json";
  if (existsSync(metaFile)) {
    return metaFile;
  }

  const outputMetaFile = resolve(".output", "nitro.json");
  if (existsSync(outputMetaFile)) {
    return outputMetaFile;
  }

  throw new Error(
    `启动错误，${metaFile} 不存在 → ${metaFile} or ${outputMetaFile}`,
  );
}

async function resolveMetaFile(
  file: string,
): Promise<{ commands?: Record<string, string> }> {
  const text = await readFile(file, { encoding: "utf-8" });
  try {
    return JSON.parse(text) ?? { commands: {} };
  } catch (error: any) {
    throw new Error(`解析错误，请检查格式 → ${file}`);
  }
}
