import { readCommerceCatalogSnapshots } from "../commerce-catalog/index.js";
import { GUEST_CART_VERSION } from "./intent.js";
import {
  presentGuestCart,
  projectGuestCartCatalogSnapshots,
  type GuestCartCatalogSnapshot,
  type GuestCartView,
} from "./present.js";
import { cartErrorText, readServerCart, type ServerCartContext, type ServerCartResult } from "./server-cart.js";

export type ServerCartPage = Readonly<{
  result: ServerCartResult;
  view: GuestCartView;
  snapshots: readonly GuestCartCatalogSnapshot[] | null;
  /** A payment the shopper opened and has not finished: the Stripe page to go back to. */
  openPayment: string | null;
  notice: string | null;
  error: string | null;
}>;

/** The Stripe page an open payment waits on; only Stripe's own checkout host is ever linked. */
export function openPaymentUrl(result: ServerCartResult): string | null {
  const checkout = result.checkout;
  if (!checkout || !checkout.attemptId || checkout.state === "paid" || checkout.state === "released-retry") return null;
  try {
    const url = new URL(checkout.redirectUrl ?? "");
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com" && !url.port && !url.username
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * Everything /cart and /checkout draw on the server: the cart from Commerce, each line's current name, photo and
 * price from Commerce's catalog, and the notes a plain form redirect leaves in the query.
 */
export async function loadServerCartPage(ctx: ServerCartContext, checkoutAdmitted: boolean): Promise<ServerCartPage> {
  const result = await readServerCart(ctx);
  const lines = result.cart?.lines ?? [];
  let snapshots: GuestCartCatalogSnapshot[] | null = [];
  let snapshotFailed = false;
  if (lines.length) {
    try {
      snapshots = projectGuestCartCatalogSnapshots(await readCommerceCatalogSnapshots(
        lines.map((line) => line.catalogItemId),
        { runtime: ctx.locals.emdash as never, request: ctx.request },
      ));
      snapshotFailed = snapshots === null;
    } catch {
      snapshots = null;
      snapshotFailed = true;
    }
  }
  const view = presentGuestCart({
    intent: { version: GUEST_CART_VERSION, lines: lines.map((line) => ({ id: line.catalogItemId, quantity: line.quantity })) },
    snapshots,
    snapshotFailed,
    checkoutAdmitted,
  });
  const errorCode = ctx.url.searchParams.get("cart_error");
  const added = ctx.url.searchParams.get("added");
  const unreadable = !result.ok && result.error.code !== "NO_CART";
  return {
    result,
    view,
    snapshots,
    openPayment: openPaymentUrl(result),
    notice: added && /^\d{1,2}$/u.test(added) ? "Added to your cart." : null,
    error: errorCode && /^[A-Z_]{2,40}$/u.test(errorCode)
      ? cartErrorText(errorCode)
      : unreadable ? cartErrorText(result.ok ? "UNAVAILABLE" : result.error.code) : null,
  };
}
