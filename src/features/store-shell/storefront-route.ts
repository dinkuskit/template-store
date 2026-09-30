import {
  buildMerchCollections,
  publicMerchCollections,
  type MerchCollection,
} from "./merch-catalog.js";
import {
  readProofDemonstrations,
  type ProofDemonstrations,
} from "./proof-demonstrations.js";
import {
  readStorefrontProfile,
  type StorefrontProfile,
} from "./profile.js";

export type StorefrontRouteContext = Readonly<{
  profile: StorefrontProfile;
  demonstrations: ProofDemonstrations | null;
  collections: readonly MerchCollection[];
}>;

export async function loadStorefrontRouteContext(
  entries: readonly { id: string; data: Record<string, unknown> }[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<StorefrontRouteContext> {
  const profile = readStorefrontProfile(env);
  const demonstrations = await readProofDemonstrations(env);
  return {
    profile,
    demonstrations,
    collections: publicMerchCollections(
      buildMerchCollections(entries),
      demonstrations?.managed.price.listable === true,
      demonstrations?.unmanaged.price.listable === true,
    ),
  };
}
