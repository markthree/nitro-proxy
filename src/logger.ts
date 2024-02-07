import { createConsola } from "consola";

export const logger = createConsola().withTag("nitro-proxy");

export function confirm(msg: string) {
  return logger.prompt(msg, {
    type: "confirm",
  });
}
