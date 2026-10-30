import { AsyncLocalStorage } from "node:async_hooks";

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
 * with `role` when they scheduled it and still can. `itemId` is the product an
 * older store's Commerce product field named while Commerce linked the page to
 * nothing; Commerce holds a page's link now (template-no-commerce-box-20261029),
 * so a page Commerce links, or one without the field, names none.
 */
export type ScheduleGrant = { by: string; role: number; itemId?: string; scheduledAt: string };
/**
 * - `proposals`: every schedule asked for since the record was made, written
 *   before EmDash stores each (a schedule from no person proposes `by: ""`,
 *   role 0). They are kept until the record is removed, so a schedule's
 *   proposal is never lost to another request's confirmation.
 * - `overflowed`: more distinct proposals than are kept; nothing is granted
 *   until the record is removed.
 * - `confirmed`: the grant for the schedule EmDash has stored (`grantFor`), read
 *   from the page itself once `content:afterSchedule` runs, so a schedule that
 *   failed grants nothing. Every new proposal can only weaken it. Null when it
 *   grants nothing.
 * - `state`: `publishing` once EmDash's scheduler starts publishing the page,
 *   `published` once that publish succeeded. Only a `published` record sells.
 */
export type PendingSale = {
  entryId: string;
  proposals: ScheduleGrant[];
  overflowed?: boolean;
  confirmed: ScheduleGrant | null;
  state: "scheduled" | "publishing" | "published";
  updatedAt: string;
};
export const PENDING_SALES = "pending_sales";
export const PRODUCT_URL_PLUGIN_ID = "dinkus-template-product-urls";

// EmDash 1.2.0 hands content-policy hooks the whole content item: id, slug and
// status at the top level, the collection's fields under `data`. Only an older
// store's page still has the Commerce product field.
function itemIdOf(content: Record<string, unknown>): string {
  const data = content.data;
  const value =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>).commerce_item_id
      : content.commerce_item_id;
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The product Commerce links a page to, asked as the person whose request this is: its id, null when none, "failed"
 * when Commerce could not say. EmDash site hooks do not receive the installed plugin runtime, so the store's publish
 * check (src/features/product-on-sale) sets this for a signed-in person's request.
 */
export type CommerceLinkLookup = (entryId: string) => Promise<string | null | "failed">;
type LinkContext = AsyncLocalStorage<CommerceLinkLookup>;
// One context per isolate, even when the dev server loads this module twice.
const linkContext: LinkContext = ((globalThis as { __dinkusCommerceLinkContext?: LinkContext }).__dinkusCommerceLinkContext ??=
  new AsyncLocalStorage<CommerceLinkLookup>());

/** Runs `fn` with `lookup` as the way this request's content-policy hooks ask Commerce for a page's product. */
export function withCommerceLinks<T>(lookup: CommerceLinkLookup, fn: () => T): T {
  return linkContext.run(lookup, fn);
}

/**
 * Whether Commerce links the page to a product. Commerce's link comes first: an older store's field value counts only
 * while Commerce links the page to nothing, cannot say, or cannot be asked (no signed-in person).
 */
async function commerceLinks(entryId: string): Promise<boolean> {
  const lookup = linkContext.getStore();
  const linked = lookup ? await lookup(entryId).catch(() => "failed" as const) : null;
  return !!linked && linked !== "failed";
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
// Distinct proposals kept per page; past this the record grants nothing until it is removed.
const MAX_PROPOSALS = 50;

/**
 * The grant for a schedule stored at `scheduledAt`: the proposals at that time must all come from one person, and the
 * least role among them is taken. None, one from no person, or proposals from different people (one of whose requests
 * may have failed, so whose schedule was stored is unknown) grant nothing. Adding proposals can only weaken it.
 */
export function grantFor(sale: Pick<PendingSale, "proposals" | "overflowed">, scheduledAt: unknown): ScheduleGrant | null {
  if (sale.overflowed) return null;
  const matching = sale.proposals.filter((proposal) => sameMoment(proposal.scheduledAt, scheduledAt));
  if (!matching.length || matching.some((proposal) => !proposal.by || proposal.by !== matching[0].by)) return null;
  return matching.reduce((low, proposal) => (proposal.role < low.role ? proposal : low));
}

const sameProposal = (a: ScheduleGrant, b: ScheduleGrant) =>
  a.by === b.by && a.role === b.role && a.itemId === b.itemId && sameMoment(a.scheduledAt, b.scheduledAt);

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
      if (itemId.length > 1024) {
        return {
          cancel: true,
          reason: "The Commerce product ID can be at most 1,024 characters.",
        };
      }

      // Commerce holds which product a page sells and refuses one another page
      // sells; the store's publish check refuses a page with no product. Only an
      // older store's field value is claimed here, one published page per value,
      // and only while Commerce links the page to nothing: a page Commerce links
      // sells Commerce's product whatever its field still says, so its field
      // claims nothing. EmDash's scheduler publishes with nobody to ask Commerce
      // as, so it keeps the claim the schedule made. The catalog item lookup is
      // enforced at render time.
      const scheduler = event.origin?.source === "scheduler";
      if (!scheduler) {
        const claimed = itemId && !(await commerceLinks(entryId)) ? itemId : "";
        if (!claimed) {
          await ctx.storage.claims.delete(entryId);
        } else {
          try {
            await ctx.storage.claims.put(entryId, {
              entryId,
              itemId: claimed,
              path: claimPath(event.content),
            } satisfies ProductClaim);
          } catch {
            const claims = await ctx.storage.claims.query();
            const holder = claims.items.find((claim) => (claim.data as ProductClaim).itemId === claimed);
            return {
              cancel: true,
              reason: `Commerce product is already published at ${(holder?.data as ProductClaim | undefined)?.path ?? `/products/${entryId}`}.`,
            };
          }
        }
      }
      // A person's own publish goes through the store's publish check, so it ends a schedule's grant. EmDash's
      // scheduled publish marks a confirmed grant as publishing; content:afterPublish completes it.
      await changePending(ctx.storage[PENDING_SALES], entryId, (current) =>
        scheduler && current?.confirmed ? { ...current, state: "publishing" } : null);
    },
    "content:beforeSchedule": async (event, ctx) => {
      if (event.collection !== PRODUCTS) return;
      const entryId = entryIdOf(event.content);
      const itemId = itemIdOf(event.content);
      if (!entryId) return { cancel: true, reason: "Product is missing its entry ID." };
      if (itemId.length > 1024) {
        return {
          cancel: true,
          reason: "The Commerce product ID can be at most 1,024 characters.",
        };
      }
      // As on publish, the field is claimed, and names the schedule's product, only while Commerce links the page to
      // nothing; the store sells a page Commerce links by Commerce's link.
      const claimed = itemId && !(await commerceLinks(entryId)) ? itemId : "";
      if (!claimed) {
        await ctx.storage.claims.delete(entryId);
      } else {
        try {
          await ctx.storage.claims.put(entryId, {
            entryId,
            itemId: claimed,
            path: claimPath(event.content),
          } satisfies ProductClaim);
        } catch {
          return {
            cancel: true,
            reason: "Commerce product is already claimed by another scheduled or published product.",
          };
        }
      }
      // Proposed before EmDash stores the schedule; content:afterSchedule grants from it only if that succeeded. A
      // proposal at the confirmed time can only weaken the grant, even if afterSchedule never runs.
      const proposal = { by: event.actor?.id ?? "", role: event.actor?.id ? event.actor.role : 0, ...(claimed ? { itemId: claimed } : {}), scheduledAt: event.scheduledAt };
      await changePending(ctx.storage[PENDING_SALES], entryId, (current) => {
        const kept = current?.proposals ?? [];
        const known = kept.some((existing) => sameProposal(existing, proposal));
        const overflowed = !!current?.overflowed || (!known && kept.length >= MAX_PROPOSALS);
        const proposals = known || overflowed ? kept : [...kept, proposal];
        const confirmed = current?.confirmed ? grantFor({ proposals: [...proposals, proposal], overflowed }, current.confirmed.scheduledAt) : null;
        return { entryId, proposals, overflowed, confirmed, state: current?.state ?? "scheduled" };
      });
    },
    "content:afterSchedule": async (event, ctx) => {
      if (event.collection !== PRODUCTS) return;
      const entryId = entryIdOf(event.content);
      if (!entryId) return;
      // The schedule EmDash holds now, read from the page (this event's copy may be older than a later schedule's). If
      // it cannot be read, nothing is granted. (The product lives in the page's draft; the store checks that the
      // published page names the granted product.)
      const page = await ctx.content?.get(PRODUCTS, entryId).catch(() => null);
      await changePending(ctx.storage[PENDING_SALES], entryId, (current) =>
        current ? { ...current, confirmed: page?.scheduledAt ? grantFor(current, page.scheduledAt) : null, state: "scheduled" } : undefined);
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
