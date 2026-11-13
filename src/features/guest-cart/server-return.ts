import { readCommerceCatalogSnapshots } from "../commerce-catalog/index.js";
import { projectGuestCartCatalogSnapshots } from "./present.js";
import { confirmedOrderView, type ConfirmedOrderView } from "./order-view.js";
import { readServerCart, writeCartCookies, type ServerCartContext } from "./server-cart.js";

/** How many times the confirming page reloads itself before it stops and says so. */
export const CONFIRMING_MAX_CHECKS = 10;
/** Seconds between the confirming page's reloads. */
export const CONFIRMING_REFRESH_SECONDS = 3;

export type CheckoutReturn =
  | Readonly<{ kind: "paid"; order: ConfirmedOrderView }>
  | Readonly<{ kind: "confirming"; refreshUrl: string; refreshSeconds: number }>
  | Readonly<{ kind: "slow" }>
  | Readonly<{ kind: "not-paid"; redirect: string }>
  | Readonly<{ kind: "no-cart" }>
  | Readonly<{ kind: "unavailable" }>;

function checkNumber(url: URL): number {
  const raw = url.searchParams.get("check") ?? "0";
  return /^\d{1,2}$/u.test(raw) ? Number(raw) : CONFIRMING_MAX_CHECKS;
}

/**
 * The thank-you page, worked out on the server from the order itself (template-thank-you-server-20261113).
 * Reading the cart runs Commerce's payment check; Stripe's session_id in the URL is never read.
 */
export async function loadCheckoutReturn(ctx: ServerCartContext): Promise<CheckoutReturn> {
  const read = await readServerCart(ctx);
  if (!read.ok) return read.error.code === "NO_CART" ? { kind: "no-cart" } : { kind: "unavailable" };
  const checkout = read.checkout;
  if (checkout.state === "paid") {
    const order = confirmedOrderView(checkout);
    if (!order) return { kind: "unavailable" };
    // Commerce reads a paid cart as empty; the next add starts a fresh cart. The key stays so a reload
    // shows this order again.
    writeCartCookies(ctx, null, 0);
    return { kind: "paid", order: await withCatalogThumbnails(ctx, order) };
  }
  if (checkout.state === "pending" && checkout.attemptId) {
    const check = checkNumber(ctx.url);
    if (check >= CONFIRMING_MAX_CHECKS) return { kind: "slow" };
    return {
      kind: "confirming",
      refreshUrl: `/checkout/success?check=${check + 1}`,
      refreshSeconds: CONFIRMING_REFRESH_SECONDS,
    };
  }
  return { kind: "not-paid", redirect: "/cart?cart_error=NOT_PAID" };
}

/** Lines whose order record has no photo take the product's current photo, as the old page did. */
async function withCatalogThumbnails(ctx: ServerCartContext, order: ConfirmedOrderView): Promise<ConfirmedOrderView> {
  const missing = [...new Set(order.lines.filter((line) => !line.thumbnail).map((line) => line.id))];
  if (!missing.length) return order;
  try {
    const snapshots = projectGuestCartCatalogSnapshots(await readCommerceCatalogSnapshots(
      missing,
      { runtime: ctx.locals.emdash as never, request: ctx.request },
    ));
    if (!snapshots) return order;
    const byId = new Map(snapshots.map((entry) => [entry.id, entry]));
    return {
      ...order,
      lines: order.lines.map((line) => {
        const found = byId.get(line.id);
        return line.thumbnail || !found?.found || !found.thumbnail ? line : { ...line, thumbnail: found.thumbnail };
      }),
    };
  } catch {
    return order;
  }
}
