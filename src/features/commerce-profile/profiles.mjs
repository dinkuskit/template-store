// Reviewed package identities. Only an operator build profile selects one.
const profiles = Object.freeze({
  stable: Object.freeze({ name: "stable", packageId: "dinkus-commerce", runtimeId: "r_gshdrqaldna3r7sn" }),
  beta: Object.freeze({ name: "beta", packageId: "dinkus-commerce-beta", runtimeId: "r_fjzjvld3ssb4j63o" }),
});

/** @param {unknown} [name] */
export function commerceProfile(name = "stable") {
  if (name !== "stable" && name !== "beta") throw new Error("Invalid DINKUS_COMMERCE_PROFILE; expected stable or beta");
  return profiles[name];
}

/** One immutable selection for Vite's server and browser bundles.
 * @param {{DINKUS_COMMERCE_PROFILE?: string}} env */
export function commerceProfileDefine(env) {
  return { __DINKUS_COMMERCE_PROFILE__: JSON.stringify(commerceProfile(env.DINKUS_COMMERCE_PROFILE).name) };
}
