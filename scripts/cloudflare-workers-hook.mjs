import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(new URL("./cloudflare-workers-register.mjs", import.meta.url), {
  parentURL: pathToFileURL(process.cwd()).href,
});
