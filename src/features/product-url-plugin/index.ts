import { definePlugin } from "emdash";

const PRODUCTS = "products";

type ProductClaim = {
  entryId: string;
  itemId: string;
  path: string;
};

/**
 * Who may have a page's product put on sale when EmDash publishes it on a
 * schedule. EmDash publishes it later with nobody signed in, so the store's
 * publish check cannot sell then; the next allowed admin request does it from
 * this record (src/features/product-on-sale), checking that `by` could sell
 * with `role` when they scheduled it and still can.
 */
export type ScheduleGrant = { by: string; role: number; itemId: string; scheduledAt: string };
/**
 * - `proposed`: the schedule a person asked for, written before EmDash stores it.
 * - `confirmed`: set from `proposed` only once EmDash has stored that schedule
 *   (`content:afterSchedule`), so a schedule that failed grants nothing; null
 *   when the stored schedule came from no person.
 * - `state`: `publishing` once EmDash's scheduler starts publishing the page,
 *   `published` once that publish succeeded. Only a `published` record sells.
 */
export type PendingSale = {
  entryId: string;
  proposed: ScheduleGrant | null;
  confirmed: ScheduleGrant | null;
  state: "scheduled" | "publishing" | "published";
  updatedAt: string;
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

type PendingStore = {
  getVersioned(id: string): Promise<{ value: unknown; revision: string } | null>;
  compareAndSet(id: string, expectedRevision: string | null, data: unknown): Promise<{ applied: boolean }>;
  compareAndDelete(id: string, expectedRevision: string): Promise<{ applied: boolean }>;
};

/** Changes a page's pending sale atomically; `next` returns the new record, null to remove it, or undefined to leave it. */
async function changePending(store: PendingStore, entryId: string, next: (current: PendingSale | null) => Omit<PendingSale, "updatedAt"> | null | undefined) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const stored = await store.getVersioned(entryId);
    const value = next((stored?.value as PendingSale | undefined) ?? null);
    if (value === undefined) return;
    const { applied } = value
      ? await store.compareAndSet(entryId, stored?.revision ?? null, { ...value, updatedAt: new Date().toISOString() } satisfies PendingSale)
      : stored
        ? await store.compareAndDelete(entryId, stored.revision)
        : { applied: true };
    if (applied) return;
  }
  // Lost every race: grant nothing rather than leave a stale grant.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const stored = await store.getVersioned(entryId);
    if (!stored || (await store.compareAndDelete(entryId, stored.revision)).applied) return;
  }
}

const sameMoment = (a: string, b: unknown) => typeof b === "string" && Date.parse(a) === Date.parse(b);

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
      // A person's own publish goes through the store's publish check, so it ends a schedule's grant. EmDash's
      // scheduled publish marks a confirmed grant as publishing; content:afterPublish completes it.
      const scheduler = event.origin?.source === "scheduler";
      await changePending(ctx.storage[PENDING_SALES], entryId, (current) =>
        scheduler && current?.confirmed ? { ...current, state: "publishing" } : null);
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
      // Proposed before EmDash stores the schedule; content:afterSchedule confirms it only if that succeeded.
      const proposed = event.actor?.id ? { by: event.actor.id, role: event.actor.role, itemId, scheduledAt: event.scheduledAt } : null;
      await changePending(ctx.storage[PENDING_SALES], entryId, (current) => ({
        entryId,
        proposed,
        confirmed: current?.confirmed ?? null,
        state: current?.state ?? "scheduled",
      }));
    },
    "content:afterSchedule": async (event, ctx) => {
      if (event.collection !== PRODUCTS) return;
      const entryId = entryIdOf(event.content);
      if (!entryId) return;
      await changePending(ctx.storage[PENDING_SALES], entryId, (current) => {
        const proposed = current?.proposed ?? null;
        // The stored schedule is the one proposed; anything else grants nothing. (The product lives in the page's draft,
        // which this event does not carry; the store checks the published page names the granted product.)
        const confirmed = proposed && sameMoment(proposed.scheduledAt, event.content.scheduledAt) ? proposed : null;
        return { entryId, proposed: null, confirmed, state: "scheduled" };
      });
    },
    "content:afterPublish": async (event, ctx) => {
      if (event.collection !== PRODUCTS) return;
      const entryId = entryIdOf(event.content);
      if (!entryId) return;
      await changePending(ctx.storage[PENDING_SALES], entryId, (current) =>
        current?.state === "publishing" ? { ...current, state: "published" } : undefined);
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
