#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { existsSync } from "fs";
import {
  build,
  copyPublicAssets,
  createNitro,
  type NitroConfig,
  prepare,
} from "nitropack";
import { resolve } from "pathe";
import { Layers } from "vite-layers";

import { consola } from "consola";
import { isString } from "m-type-tools";
import { detectPackageManager } from "nypm";
import { description, name, version } from "../package.json";
import { commonArgs } from "./common";

import { execa } from "execa";
import { readdir, readFile } from "fs/promises";
import type { UserConfig } from "vite-layers";

const logger = consola.withTag("nitro-proxy");

logger.wrapAll();

const main = defineCommand({
  meta: {
    name,
    description,
    version,
  },
  args: {
    ...commonArgs,
    port: {
      type: "string",
      default: "3000",
      description: "服务端口",
    },
    minify: {
      default: true,
      type: "boolean",
      description:
        "最小化输出（覆盖预设默认值，也可以使用 `--no-minify` 停用）。",
    },
    preset: {
      type: "string",
      default: "node-cluster",
      description: "要使用的构建预置（也可以使用 `NITRO_PRESET` 环境变量）。",
    },
  },
  async run({ args }) {
    // 覆盖端口
    overwritePort(args.port);

    // 解析 vite 配置
    const rootDir = resolve((args.dir || args._dir || ".") as string);
    const { proxy, outDir } = await resolveViteConfig(rootDir);

    // 确保 vite build
    await ensureViteBuild(rootDir, outDir);

    // 生成代理路由
    const routeRules = createProxyRouteRules(proxy);

    // 生成 nitro 服务
    const nitro = await createNitro({
      rootDir,
      dev: false,
      minify: args.minify,
      preset: args.preset,
      publicAssets: [{
        dir: outDir,
        maxAge: 3600, // 一天
      }],
      routeRules,
      sourceMap: false,
      compressPublicAssets: {
        gzip: true,
        brotli: true,
      },
    });
    await prepare(nitro);
    await copyPublicAssets(nitro);
    await build(nitro);
    await nitro.close();

    logger.success(`生成代理服务成功 → ${nitro.options.output.dir}`);
  },
});

runMain(main);

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

/**
 * 解析 vite 配置
 */
async function resolveViteConfig(dir: string) {
  const viteConfig = await Layers({
    extends: [dir],
  }) as UserConfig;
  const outDir = viteConfig?.build?.outDir ?? "./dist";

  const proxy = viteConfig.server?.proxy ?? {};
  return {
    proxy,
    outDir,
  };
}

/**
 * 创建代理路由规则
 */
function createProxyRouteRules(
  proxy: NonNullable<NonNullable<UserConfig["server"]>["proxy"]>,
) {
  const routeRules: NitroConfig["routeRules"] = {};

  for (const r in proxy) {
    if (Object.prototype.hasOwnProperty.call(proxy, r)) {
      const meta = proxy[r];
      if (typeof meta === "undefined") {
        continue;
      }
      const route = `${r}/**`;

      let target: string;
      if (isString(meta)) {
        target = meta;
      } else if (isString(meta.target)) {
        target = meta.target;
      } else {
        throw new Error(`代理类型错误，仅支持 string 类型 → ${meta.target}`);
      }
      // 规范代理类型
      if (target.endsWith("/")) {
        target = target.slice(0, -1);
      }
      routeRules[route] = {
        proxy: `${target}/**`,
      };
      logger.success("代理成功 → " + target);
    }
  }
  return routeRules;
}

/**
 * 确保进行 vite build
 */
async function ensureViteBuild(rootDir: string, outDir: string) {
  if (existsSync(outDir) && (await readdir(outDir)).length > 0) {
    return;
  }

  logger.warn(`${outDir} 不存在，可能没有进行 vite build`);

  const shouldAutoBuild = await logger.prompt("是否自动 vite build", {
    type: "confirm",
  });

  if (!shouldAutoBuild) {
    throw new Error(`请先进行 vite build`);
  }

  const packageJsonFile = resolve(rootDir, "package.json");
  if (!existsSync(packageJsonFile)) {
    logger.warn(`不存在 ${packageJsonFile}，开始执行 npx vite build`);
    await npxVitBuild();
    return;
  }

  try {
    const packageJsonText = await readFile(packageJsonFile, {
      encoding: "utf-8",
    });
    const scripts: Record<string, string> =
      JSON.parse(packageJsonText)["scripts"];

    if (!scripts) {
      logger.warn(
        `${packageJsonFile} 中不存在 scripts，开始执行 npx vite build`,
      );
      await npxVitBuild();
      return;
    }

    const pm = await detectPackageManager(rootDir) ?? { name: "npm" };

    for (const [scriptKey, scriptValue] of Object.entries(scripts)) {
      if (scriptValue.includes("vite build")) {
        logger.info(`执行 ${pm.name} run ${scriptKey} → ${scriptValue}`);
        await execa(pm.name, ["run", scriptKey], {
          cwd: rootDir,
          stdin: "inherit",
          stderr: "inherit",
          stdout: "inherit",
        });
        return;
      }
    }
  } catch (error) {
    logger.error(error);
    logger.error(`解析 ${packageJsonFile} 错误，开始执行 npx vite build`);
    await npxVitBuild();
  }

  async function npxVitBuild() {
    await execa("npx", ["vite", "build"], {
      cwd: rootDir,
      stdin: "inherit",
      stderr: "inherit",
      stdout: "inherit",
    });
  }
}
