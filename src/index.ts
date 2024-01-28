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

import { logger } from "./logger";
import { detectPackageManager } from "nypm";
import { description, name, version } from "../package.json";
import { checkNodeVersion, commonArgs } from "./common";

import { execa } from "execa";
import { emptyDir } from "fs-extra";
import { readdir, readFile } from "fs/promises";
import type { UserConfig } from "vite-layers";
import { green, red, yellow } from "kolorist";
import nitroPublic from "nitro-public-module";
import { isPackageExists } from "local-pkg";

const main = defineCommand({
  meta: {
    name,
    version,
    description,
  },
  subCommands: {
    start: () => import("./start").then((r) => r.default),
  },
  args: {
    ...commonArgs,
    minify: {
      default: true,
      type: "boolean",
      description: "最小化输出 (覆盖预设默认值，也可以使用 `--no-minify` 停用)",
    },
    force: {
      default: false,
      type: "boolean",
      description:
        "强制 vite 重新打包 (覆盖预设默认值，也可以使用 `--force` 启用)",
    },
    preset: {
      type: "string",
      default: "node-cluster",
      description: "要使用的构建预置 (也可以使用 `NITRO_PRESET` 环境变量)",
    },
    type: {
      type: "string",
      default: detectType(),
      valueHint: "spa | ssg",
      description: "项目类型 (默认会自动推断)",
    },
  },
  setup() {
    checkNodeVersion();
  },
  async run({ args }) {
    if (!checkType(args.type)) {
      logger.error("错误项目类型，仅支持 --type=ssg 或者 --type=spa");
      return;
    }

    // 解析 vite 配置
    const rootDir = resolve((args.dir || args._dir || ".") as string);

    const { proxy, outDir, base } = await resolveViteConfig(rootDir);

    // 可能要清理 dist 目录
    await mayBeCleanDist(rootDir, outDir, args.force);

    // 确保 vite build
    await ensureViteBuild(rootDir, outDir);

    // 生成代理路由
    const routeRules = createProxyRouteRules(proxy);

    // 生成 nitro 服务
    const nitro = await createNitro({
      rootDir,
      dev: false,
      baseURL: base,
      minify: args.minify,
      preset: args.preset,
      publicAssets: [
        {
          dir: outDir,
          maxAge: 3600, // 一天
        },
      ],
      routeRules,
      sourceMap: false,
      compressPublicAssets: {
        gzip: true,
        brotli: true,
      },
      modules: [
        nitroPublic({
          preset: args.type as "spa" | "ssg",
        }),
      ],
    });
    await prepare(nitro);
    await copyPublicAssets(nitro);
    await build(nitro);
    await nitro.close();

    logger.success(`生成代理服务成功 → ${green(nitro.options.output.dir)}`);

    logger.success(`使用 ${green("npx nitro-proxy start")} 启动服务`);
  },
});

runMain(main);

/**
 * 解析 vite 配置
 */
async function resolveViteConfig(dir: string) {
  const viteConfig = (await Layers({
    extends: [dir],
  })) as UserConfig;
  const outDir = viteConfig?.build?.outDir ?? "./dist";

  const proxy = viteConfig.server?.proxy ?? {};
  return {
    base: viteConfig.base,
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
        throw new Error(
          `代理类型错误，仅支持 string 类型 → ${red(String(meta.target))}`,
        );
      }
      // 规范代理类型
      if (target.endsWith("/")) {
        target = target.slice(0, -1);
      }
      routeRules[route] = {
        proxy: `${target}/**`,
      };
      logger.success(`代理成功 → ${green(target)}`);
    }
  }
  return routeRules;
}

/**
 * 确保进行 vite build
 */
async function ensureViteBuild(rootDir: string, outDir: string) {
  const dist = resolve(rootDir, outDir);
  if (existsSync(dist) && (await readdir(dist)).length > 0) {
    return;
  }

  logger.warn(`${yellow(outDir)} 不存在，可能没有进行 ${yellow("vite build")}`);

  const shouldAutoBuild = await logger.prompt(
    `是否自动 ${green("vite build")}`,
    {
      type: "confirm",
    },
  );

  if (!shouldAutoBuild) {
    throw new Error(`请先进行 vite build`);
  }

  const packageJsonFile = resolve(rootDir, "package.json");
  if (!existsSync(packageJsonFile)) {
    logger.warn(
      `不存在 ${yellow(packageJsonFile)}，开始执行 ${green("npx vite build")}`,
    );
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
        `${yellow(packageJsonFile)} 中不存在 ${
          yellow(
            scripts,
          )
        }，开始执行 ${green("npx vite build")}`,
      );
      await npxVitBuild();
      return;
    }

    const pm = (await detectPackageManager(rootDir)) ?? { name: "npm" };

    for (const [scriptKey, scriptValue] of Object.entries(scripts)) {
      if (scriptValue.includes("vite build")) {
        logger.info(`执行 ${pm.name} run ${scriptKey} → ${green(scriptValue)}`);
        await execa(pm.name, ["run", scriptKey], {
          cwd: rootDir,
          stdio: "inherit",
        });
        return;
      }
    }
  } catch (error) {
    logger.error(error);
    logger.error(
      `运行 ${red(packageJsonFile)} 命令错误，开始执行 ${
        green(
          "npx vite build",
        )
      }`,
    );
    await npxVitBuild();
  }

  async function npxVitBuild() {
    await execa("npx", ["vite", "build"], {
      cwd: rootDir,
      stdio: "inherit",
    });
  }
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

/**
 * 可能要清理 dist 目录
 */
async function mayBeCleanDist(
  rootDir: string,
  outDir: string,
  force?: boolean,
) {
  const dist = resolve(rootDir, outDir);
  if (existsSync(dist)) {
    if (!force) {
      force = await logger.prompt(
        `已存在 ${yellow(outDir)}，是否强制重新生成`,
        {
          type: "confirm",
        },
      );
    }
    if (force) {
      await emptyDir(dist);
    }
  }
}

function detectType() {
  const packages = ["vite-ssg"];
  const isSsg = packages.some((pkg) => isPackageExists(pkg));
  return isSsg ? "ssg" : "spa";
}

function checkType(type: string) {
  const enabledTypes = ["ssg", "spa"];
  return enabledTypes.some((t) => t === type);
}
