/**
 * 可能是 windows 下的 cmd 文件，默认我们希望它能够静默执行
 * 注意这可能会造成内存泄漏，所以需要手动清理
 * TODO: 通过记录 pid 文件标识来处理
 */

import { execa } from "execa";

await execa(process.argv.shift(), process.argv, {
  cleanup: true,
  stdio: "inherit",
});
