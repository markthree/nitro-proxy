import { createConsola } from "consola";

export const logger = createConsola().withTag("nitro-proxy");

logger.wrapAll();
