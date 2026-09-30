export const STOREFRONT_PROFILE_SHIPPING = "shipping";
export const STOREFRONT_PROFILE_PROOF = "proof";

export type StorefrontProfile =
  | typeof STOREFRONT_PROFILE_SHIPPING
  | typeof STOREFRONT_PROFILE_PROOF;

const PROOF_PROFILE_VALUES = new Set(["proof", "development"]);

export function readStorefrontProfile(
  env: NodeJS.ProcessEnv = process.env,
): StorefrontProfile {
  const raw = env.DINKUS_STOREFRONT_PROFILE?.trim().toLowerCase();
  if (raw && PROOF_PROFILE_VALUES.has(raw)) {
    return STOREFRONT_PROFILE_PROOF;
  }
  return STOREFRONT_PROFILE_SHIPPING;
}

export function isProofStorefrontProfile(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return readStorefrontProfile(env) === STOREFRONT_PROFILE_PROOF;
}

export function isProofMutationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isProofStorefrontProfile(env) && env.DINKUS_PROOF_MODE === "1";
}
