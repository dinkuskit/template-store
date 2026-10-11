import { resolve } from "node:path";

const ROOTS = Object.freeze({
  proof: ".artifacts/e2e",
  shipping: ".artifacts/e2e-shipping",
});
const PROFILE_VALUES = new Set(Object.keys(ROOTS));
const SAFE_INHERITED_ENV = new Set([
  "CI",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "NO_COLOR",
  "PATH",
  "PNPM_HOME",
  "PWD",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TZ",
]);
const SENSITIVE_ENV = /(?:token|secret|password|credential|cookie|authorization|api[_-]?key|payment|stripe|paypal|checkout)/iu;

export function validateOfflineE2EOptions({ root, profile, port }) {
  if (!PROFILE_VALUES.has(profile)) {
    throw new Error(`offline e2e server refuses unknown profile: ${String(profile)}`);
  }
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65_535) {
    throw new Error(`offline e2e server refuses invalid port: ${String(port)}`);
  }
  const relativeDir = ROOTS[profile];
  const artifactDir = resolve(root, relativeDir);
  const expectedRoot = resolve(root, ".artifacts");
  if (!artifactDir.startsWith(`${expectedRoot}/`)) {
    throw new Error("offline e2e server refuses a disposable directory outside .artifacts");
  }
  const siteOrigin = `http://127.0.0.1:${numericPort}`;
  const parsedOrigin = new URL(siteOrigin);
  if (parsedOrigin.protocol !== "http:" || parsedOrigin.hostname !== "127.0.0.1") {
    throw new Error("offline e2e server requires a loopback HTTP origin");
  }
  return Object.freeze({
    root: resolve(root),
    profile,
    port: numericPort,
    relativeDir,
    artifactDir,
    siteOrigin,
  });
}

export function buildOfflineE2EEnvironment(inherited, options) {
  const validated = validateOfflineE2EOptions(options);
  const env = {};
  for (const [key, value] of Object.entries(inherited ?? {})) {
    if (value !== undefined && SAFE_INHERITED_ENV.has(key) && !SENSITIVE_ENV.test(key)) {
      env[key] = value;
    }
  }
  return {
    ...env,
    ASTRO_DEV_BACKGROUND: "0",
    DINKUS_PROOF_MODE: validated.profile === "proof" ? "1" : "0",
    DINKUS_STOREFRONT_PROFILE: validated.profile,
    ...(validated.profile === "proof" ? { DINKUS_CATALOG_PROFILE: "native-development" } : {}),
    DINKUS_TEMPLATE_DB_URL: `file:./${validated.relativeDir}/content.db`,
    DINKUS_TEMPLATE_UPLOADS_DIR: `./${validated.relativeDir}/uploads`,
    EMDASH_SITE_URL: validated.siteOrigin,
  };
}

export { ROOTS as OFFLINE_E2E_ARTIFACT_ROOTS };
