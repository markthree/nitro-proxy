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

import { description, name, version } from "../package.json";
import { commonArgs } from "./common";
import { consola } from "consola";
import { isString } from "m-type-tools";

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
    minify: {
      type: "boolean",
      description:
        "最小化输出（覆盖预设默认值，也可以使用 `--no-minify` 停用）。",
    },
    preset: {
      type: "string",
      description: "要使用的构建预置（也可以使用 `NITRO_PRESET` 环境变量）。",
    },
    port: {
      type: "string",
      default: "3000",
      description: "服务端口",
    },
  },
  async run({ args }) {
    // 覆盖端口
    overwritePort(args.port);

    // 解析 vite 配置
    const rootDir = resolve((args.dir || args._dir || ".") as string);
    const { proxy, outDir } = await resolveViteConfig(rootDir);

    if (!existsSync(outDir)) {
      throw new Error(`未找到 ${outDir} 请先进行 vite build`);
    }

    // 生成代理路由
    const routeRules = createProxyRouteRules(proxy);

    // 生成 nitro 服务
    const nitro = await createNitro({
      rootDir,
      dev: false,
      minify: args.minify ?? true,
      preset: args.preset ?? "node-cluster",
      publicAssets: [{
        dir: outDir,
        maxAge: 3600,
      }],
      routeRules,
      sourceMap: false,
    });
    await prepare(nitro);
    await copyPublicAssets(nitro);
    await build(nitro);
    await nitro.close();
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
