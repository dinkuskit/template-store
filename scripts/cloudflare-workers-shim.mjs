const PLATFORM_ENV = Symbol.for("dinkus.localPlatformEnv");

function platformEnv() {
  const source = globalThis[PLATFORM_ENV];
  if (typeof source !== "object" || source === null) return {};
  return source;
}

export const env = new Proxy(
  {},
  {
    get(_target, property) {
      return platformEnv()[property];
    },
    has(_target, property) {
      return property in platformEnv();
    },
  },
);
