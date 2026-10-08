import { definePlugin } from "emdash";

const PRODUCTS = "products";

type ProductClaim = {
  entryId: string;
  itemId: string;
  path: string;
};

function itemIdOf(content: Record<string, unknown>): string {
  return typeof content.commerce_item_id === "string"
    ? content.commerce_item_id.trim()
    : "";
}

function entryIdOf(content: Record<string, unknown>): string {
  return typeof content.id === "string" ? content.id : "";
}

function claimPath(content: Record<string, unknown>): string {
  const slug = typeof content.slug === "string" ? content.slug.trim() : "";
  return slug ? `/products/${slug}` : `/products/${entryIdOf(content)}`;
}

export const productUrlPlugin = definePlugin({
  id: "dinkus-template-product-urls",
  version: "1.0.0",
  capabilities: ["content:read", "content:publish"],
  storage: {
    claims: {
      indexes: [],
      uniqueIndexes: ["itemId"],
    },
  },
  hooks: {
    "content:beforePublish": async (event, ctx) => {
      if (event.collection !== PRODUCTS) return;

      const entryId = entryIdOf(event.content);
      const itemId = itemIdOf(event.content);
      if (!entryId) return { cancel: true, reason: "Product is missing its entry ID." };
      if (!itemId || itemId.length > 1024) {
        return {
          cancel: true,
          reason: "Publishing requires a non-empty Commerce product ID of at most 1,024 characters.",
        };
      }

      // EmDash site hooks do not receive the installed plugin runtime. The
      // installed catalog item lookup is therefore enforced at render time;
      // this hook deliberately proves format plus the atomic claim only.
      try {
        await ctx.storage.claims.put(entryId, {
          entryId,
          itemId,
          path: claimPath(event.content),
        } satisfies ProductClaim);
      } catch {
        const claims = await ctx.storage.claims.query();
        const holder = claims.items.find((claim) => (claim.data as ProductClaim).itemId === itemId);
        return {
          cancel: true,
          reason: `Commerce product is already published at ${(holder?.data as ProductClaim | undefined)?.path ?? `/products/${entryId}`}.`,
        };
      }
    },
    "content:afterUnpublish": async (event, ctx) => {
      if (event.collection !== PRODUCTS) return;
      const entryId = entryIdOf(event.content);
      if (entryId) await ctx.storage.claims.delete(entryId);
    },
    "content:afterDelete": async (event, ctx) => {
      if (event.collection !== PRODUCTS) return;
      await ctx.storage.claims.delete(event.id);
    },
  },
});
