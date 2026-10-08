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
  collectionEntriesOrEnv: readonly { id: string; data: Record<string, unknown> }[] | NodeJS.ProcessEnv = [],
  env: NodeJS.ProcessEnv = process.env,
): Promise<StorefrontRouteContext> {
  const collectionEntries = Array.isArray(collectionEntriesOrEnv) ? collectionEntriesOrEnv : [];
  const runtimeEnv = (Array.isArray(collectionEntriesOrEnv) ? env : collectionEntriesOrEnv) as NodeJS.ProcessEnv;
  const profile = readStorefrontProfile(runtimeEnv);
  const demonstrations = await readProofDemonstrations(runtimeEnv);
  return {
    profile,
    demonstrations,
    collections: publicMerchCollections(
      buildMerchCollections(entries, collectionEntries),
      demonstrations?.managed.price.listable === true,
      demonstrations?.unmanaged.price.listable === true,
    ),
  };
}
