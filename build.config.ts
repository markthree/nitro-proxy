import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  failOnWarn: false,
  rollup: {
    esbuild: {
      minify: true,
      treeShaking: true,
      target: ["node14", "es2015"],
    },
  },
});
