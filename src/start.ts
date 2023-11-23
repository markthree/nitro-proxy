import { defineCommand } from "citty";
import { execa } from "execa";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { logger } from "./logger";

export default defineCommand({
  meta: {
    name: "start",
    description: "Build the project from current directory",
  },
  args: {
    port: {
      type: "string",
      default: "3000",
      description: "服务端口",
    },
  },
  async run({ args }) {
    // 覆盖端口
    overwritePort(args.port);

    // 搜索 metaFile
    const metaFile = findNitroMetaJson();

    // 解析 preview 命令
    const metaJson = await resolveMetaFile(metaFile);

    if (!metaJson.commands.preview) {
      throw new Error(`不存在 commands.preview 命令 -> ${metaFile}`);
    }

    const { preview } = metaJson.commands;

    logger.success(`执行 preview 命令 -> ${preview}`);

    const [runtime, ...commands] = preview.split(" ");
    await execa(runtime, commands, {
      stdio: "inherit",
    });
  },
});

/**
 * 重写端口
 */
function overwritePort(port: string) {
  if (isNaN(Number(port))) {
    throw new TypeError("服务端口号 port 必须是数字字符串");
  }
  process.env.PORT = String(parseInt(port, 10));
  logger.success(`服务端口 → ${process.env.PORT}`);
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

async function resolveMetaFile(file: string) {
  const text = await readFile(file, { encoding: "utf-8" });
  try {
    return JSON.parse(text) ?? {};
  } catch (error: any) {
    throw new Error(`解析错误，请检查格式 -> ${file}`);
  }
}
