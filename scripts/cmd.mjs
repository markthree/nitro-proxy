/**
 * 可能是 windows 下的 cmd 文件，默认我们希望它能够静默执行
 * 注意这可能会造成内存泄漏，所以需要手动清理
 */
// TODO 输出 pid
// TODO 输出启动时的错误
import { execa } from "execa";

const [file, ...commands] = process.argv.splice(2);

await execa(file, commands, {
  cleanup: true,
  stdio: "inherit",
});
