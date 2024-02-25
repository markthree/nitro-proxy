import { defineCommand, runMain } from "citty";
import { existsSync } from "fs";
import {
  build,
  copyPublicAssets,
  createNitro,
  type NitroConfig,
  prepare,
} from "nitropack";
import { join, resolve } from "pathe";
import { Layers, load } from "vite-layers";

import { confirm, logger } from "./logger";
import { detectPackageManager } from "nypm";
import { description, name, version } from "../package.json";
import { checkNodeVersion, commonArgs, usePort } from "./common";

import { defu } from "defu";
import { execa } from "execa";
import { lstat, readdir, readFile } from "fs/promises";
import type { UserConfig } from "vite-layers";
import { green, red, yellow } from "kolorist";
import nitroPort from "nitro-port-module";
import nitroPublic from "nitro-public-module";
import { isPackageExists } from "local-pkg";
export { defineNitroConfig } from "nitropack/config";

export const DEFAULT_CONFIG_FILES = [
  "nitro.config.js",
  "nitro.config.mjs",
  "nitro.config.ts",
  "nitro.config.cjs",
  "nitro.config.mts",
  "nitro.config.cts",
];

async function isFile(path: string) {
  try {
    const stat = await lstat(path);
    return stat.isFile();
  } catch (error) {
    return false;
  }
}
export async function detectConfigFile(base: string) {
  if (await isFile(base)) {
    return base;
  }
  for (const filename of DEFAULT_CONFIG_FILES) {
    const filePath = join(base, filename);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
}

const main = defineCommand({
  meta: {
    name,
    version,
    description,
  },
  subCommands: {
    stop: () => import("./stop").then((r) => r.default),
    start: () => import("./start").then((r) => r.default),
    find: () => import("./find").then((r) => r.default),
    "start-cmd": () => import("./start-cmd").then((r) => r.default),
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
    port: {
      type: "string",
      default: "3000",
      description: "默认端口",
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

    // 确保 build
    await ensureBuild(rootDir, outDir, args.type, args.force);

    // 生成代理路由
    const routeRules = createProxyRouteRules(proxy);

    // 加载 nitro.config.* 的配置
    const configFile = await detectConfigFile(rootDir);
    const options = configFile ? await load(configFile) : {};

    const config = defu(options, {
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
        nitroPort({
          port: Number(usePort(args.port)),
        }),
        nitroPublic({
          preset: args.type as "spa" | "ssg",
        }),
      ],
    });

    // 生成 nitro 服务
    const nitro = await createNitro(config);
    await prepare(nitro);
    await copyPublicAssets(nitro);
    await build(nitro);
    await nitro.close();

    logger.success(`生成代理服务成功 → ${green(nitro.options.output.dir)}`);

    logger.success(`使用 ${green("npx nitro-proxy start")} 启动服务`);
  },
});

export async function runCli() {
  await runMain(main);
}

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
 * 确保进行 build
 */
async function ensureBuild(
  rootDir: string,
  outDir: string,
  type = detectType(),
  force = false,
) {
  const dist = resolve(rootDir, outDir);

  const pkg = type === "ssg" ? "vite-ssg" : "vite";
  const pkgBuild = `${pkg} build`;

  if (await noEmpty(dist)) {
    if (!force) {
      force = await confirm(`已存在 ${yellow(outDir)}，是否强制重新生成`);
    }
    if (!force) {
      return;
    }
  } else {
    logger.warn(`可能没有进行 ${yellow(pkgBuild)} → ${yellow(outDir)}`);
    const shouldAutoBuild = await confirm(`是否自动 ${green(pkgBuild)}`);
    if (!shouldAutoBuild) {
      throw new Error(`请先进行 ${pkgBuild}`);
    }
  }

  const packageJsonFile = resolve(rootDir, "package.json");
  if (!existsSync(packageJsonFile)) {
    logger.warn(
      `不存在 ${yellow(packageJsonFile)}，开始执行 ${green(`npx ${pkgBuild}`)}`,
    );
    await npxBuild(pkgBuild);
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
        }，开始执行 ${green(`npx ${pkgBuild}`)}`,
      );
      await npxBuild(pkgBuild);
      return;
    }

    const pm = (await detectPackageManager(rootDir)) ?? { name: "npm" };

    for (const [scriptKey, scriptValue] of Object.entries(scripts)) {
      if (scriptValue.includes(`${pkgBuild}`)) {
        logger.info(`执行 ${pm.name} run ${scriptKey} → ${green(scriptValue)}`);
        await execa(pm.name, ["run", scriptKey], {
          cwd: rootDir,
          stdio: "inherit",
        });
        return;
      }
    }

    throw new TypeError(
      `未发现 ${pkgBuild} 的脚本 → ${yellow(packageJsonFile)}`,
    );
  } catch (error) {
    logger.error(error);
    logger.error(
      `运行 ${red(packageJsonFile)} 命令错误，开始执行 ${
        green(
          "npx vite build",
        )
      }`,
    );
    await npxBuild(pkgBuild);
  }

  async function npxBuild(script: string) {
    await execa("npx", script.split(" "), {
      cwd: rootDir,
      stdio: "inherit",
    });
  }
}

function isString(v: unknown): v is string {
  return typeof v === "string";
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

async function noEmpty(dir: string) {
  if (!existsSync(dir)) {
    return false;
  }
  const entrys = await readdir(dir);
  return entrys.length > 0;
}
