import type { ManagedProductAvailability } from "../managed-product-availability/index.js";
import type { UnmanagedProductSellability } from "../unmanaged-product-sellability/index.js";
import { isProofStorefrontProfile } from "./profile.js";

export type ProofDemonstrations = Readonly<{
  managed: ManagedProductAvailability;
  unmanaged: UnmanagedProductSellability;
}>;

export async function readProofDemonstrations(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProofDemonstrations | null> {
  if (!isProofStorefrontProfile(env)) {
    return null;
  }
  const [{ managedProductAvailabilityRuntime }, { unmanagedProductSellabilityRuntime }] =
    await Promise.all([
      import("../managed-product-availability/index.js"),
      import("../unmanaged-product-sellability/index.js"),
    ]);
  const [managed, unmanaged] = await Promise.all([
    managedProductAvailabilityRuntime.read(),
    unmanagedProductSellabilityRuntime.read(),
  ]);
  return { managed, unmanaged };
}
