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

import type { UserConfig } from "vite-layers";

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
    if (isNaN(Number(args.port))) {
      throw new Error("服务端口号 port 必须是数字字符串");
    }

    process.env.PORT = args.port;
    const rootDir = resolve((args.dir || args._dir || ".") as string);
    const viteConfig = await Layers({
      extends: [rootDir],
    }) as UserConfig;

    const outDir = viteConfig?.build?.outDir ?? "./dist";

    if (!existsSync(outDir)) {
      throw new Error(`未找到 ${outDir} 请先进行 vite build`);
    }

    const proxy = viteConfig.server?.proxy ?? {};
    const routeRules: NitroConfig["routeRules"] = {};
    for (const r in proxy) {
      if (Object.prototype.hasOwnProperty.call(proxy, r)) {
        const meta = proxy[r];
        const route = `${r}/**`;
        const target = typeof meta === "string" ? meta : meta.target;
        routeRules[route] = {
          proxy: `${target}/**`,
        };
      }
    }

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
      experimental: {
        asyncContext: true,
      },
      sourceMap: false,
    });
    await prepare(nitro);
    await copyPublicAssets(nitro);
    await build(nitro);
    await nitro.close();
  },
});

runMain(main);
