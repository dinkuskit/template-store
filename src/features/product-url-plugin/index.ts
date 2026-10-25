import { definePlugin } from "emdash";

const PRODUCTS = "products";

type ProductClaim = {
  entryId: string;
  itemId: string;
  path: string;
};

/**
 * A schedule someone made through the admin or MCP. EmDash publishes the page
 * later with nobody signed in, so the store's publish check cannot put its
 * product on sale then; the next allowed admin request does it from this record
 * (src/features/product-on-sale), checking that `by` could sell with `role`
 * when they scheduled it and still can.
 */
export type PendingSale = {
  entryId: string;
  itemId: string;
  scheduledAt: string;
  by: string;
  role: number;
  recordedAt: string;
};
export const PENDING_SALES = "pending_sales";
export const PRODUCT_URL_PLUGIN_ID = "dinkus-template-product-urls";

// EmDash 1.2.0 hands content-policy hooks the whole content item: id, slug and
// status at the top level, the collection's fields under `data`.
function itemIdOf(content: Record<string, unknown>): string {
  const data = content.data;
  const value =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>).commerce_item_id
      : content.commerce_item_id;
  return typeof value === "string" ? value.trim() : "";
}

function entryIdOf(content: Record<string, unknown>): string {
  return typeof content.id === "string" ? content.id : "";
}

function claimPath(content: Record<string, unknown>): string {
  const slug = typeof content.slug === "string" ? content.slug.trim() : "";
  return slug ? `/products/${slug}` : `/products/${entryIdOf(content)}`;
}

export function createPlugin() {
  return definePlugin({
  id: PRODUCT_URL_PLUGIN_ID,
  version: "1.0.0",
  capabilities: ["content:read", "content:publish", "hooks.content-policy:register"],
  storage: {
    claims: {
      indexes: [],
      uniqueIndexes: ["itemId"],
    },
    [PENDING_SALES]: {
      indexes: [],
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
      // A person's own publish goes through the store's publish check; only EmDash's scheduled publish leaves
      // the sale to the pending record.
      if (event.origin?.source !== "scheduler") await ctx.storage[PENDING_SALES].delete(entryId);
    },
    "content:beforeSchedule": async (event, ctx) => {
      if (event.collection !== PRODUCTS) return;
      const entryId = entryIdOf(event.content);
      const itemId = itemIdOf(event.content);
      if (!entryId || !itemId || itemId.length > 1024) {
        return {
          cancel: true,
          reason: "Scheduling requires a non-empty Commerce product ID of at most 1,024 characters.",
        };
      }
      try {
        await ctx.storage.claims.put(entryId, {
          entryId,
          itemId,
          path: claimPath(event.content),
        } satisfies ProductClaim);
      } catch {
        return {
          cancel: true,
          reason: "Commerce product is already claimed by another scheduled or published product.",
        };
      }
      // Recorded before EmDash stores the schedule; a schedule that then fails leaves a record the store's sweep
      // ignores (it only sells a page EmDash has since published with this product) and later drops.
      if (event.actor?.id) {
        await ctx.storage[PENDING_SALES].put(entryId, {
          entryId,
          itemId,
          scheduledAt: event.scheduledAt,
          by: event.actor.id,
          role: event.actor.role,
          recordedAt: new Date().toISOString(),
        } satisfies PendingSale);
      } else {
        await ctx.storage[PENDING_SALES].delete(entryId);
      }
    },
    "content:afterUnschedule": async (event, ctx) => {
      if (event.collection !== PRODUCTS) return;
      const entryId = entryIdOf(event.content);
      if (entryId) await ctx.storage[PENDING_SALES].delete(entryId);
    },
    "content:afterUnpublish": async (event, ctx) => {
      if (event.collection !== PRODUCTS) return;
      const entryId = entryIdOf(event.content);
      if (entryId) {
        await ctx.storage.claims.delete(entryId);
        await ctx.storage[PENDING_SALES].delete(entryId);
      }
    },
    "content:afterDelete": async (event, ctx) => {
      if (event.collection !== PRODUCTS) return;
      await ctx.storage.claims.delete(event.id);
      await ctx.storage[PENDING_SALES].delete(event.id);
    },
  },
  });
}
