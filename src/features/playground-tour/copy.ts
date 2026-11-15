/**
 * The playground tour's words (GrillTrack playground-guided-tour-20261023).
 * They live in the CMS page "playground-tour", which only the playground seeds:
 * each step or hint is a heading and a paragraph whose keys name it. The admin
 * card, the tour page and the shop guide read that page; a step whose blocks
 * are gone or empty falls back to the words below.
 */
import type { PortableTextBlock } from "emdash";

export const TOUR_PAGE_SLUG = "playground-tour";

export const TOUR_COPY_DEFAULTS = {
  intro: {
    title: "This is your own store to play with",
    text: "Nobody else sees it, nothing here costs anything, and it all resets when your playground session ends. Follow the steps; each one ticks itself off when you do it.",
  },
  "edit-product": {
    title: "Edit a product",
    text: "Open Content > Products, pick a product and change its short description. Press Save, then Publish changes, and your shop shows it straight away.",
  },
  "connect-payments": {
    title: "Connect Payments",
    text: "Open Payment settings and press Connect, then Authorize Payments at DinkusKit. On a real store you approve this once at DinkusKit.com; here it's pretend, and Payments shows Stripe test mode ready.",
  },
  "place-order": {
    title: "Place a test order",
    text: "Buy something in your shop and pay with the test card 4242 4242 4242 4242, a future expiry date and a three-digit CVC. No real money moves.",
  },
  "look-at-shop": {
    title: "Look at your shop",
    text: "Checkout is switched off in this playground, so the cart says checkout is unavailable. On a real store, shoppers pay by card through Payments.",
  },
  "ship-order": {
    title: "Ship an order",
    text: "Open Shipments and press Connect, then open a paid order and press Make practice label. Practice labels are free and mark the order shipped.",
  },
  "real-store": {
    title: "Start your real store",
    text: "A real DinkusKit store runs these same plugins on your own EmDash site. You connect it to DinkusKit.com for card payments and postage, and your orders and customers stay yours.",
  },
  "hint-pick-product": { title: "Pick a product", text: "Press a product to open it." },
  "hint-add-to-cart": { title: "Add it to your cart", text: "Pick an option if there is one, then press Add to cart." },
  "hint-open-cart": { title: "Open your cart", text: "It's in your cart. Press Cart to check out." },
  "hint-cart-checkout": { title: "Check out", text: "Press the checkout button." },
  "hint-checkout-pay": {
    title: "Pay with the test card",
    text: "Fill in an email and a US address and continue. On the payment page, use card 4242 4242 4242 4242, a future expiry date and a three-digit CVC.",
  },
  "hint-order-placed": { title: "Your test order is in", text: "Next, ship it: make its practice label in your admin." },
} as const;

export type TourCopyKey = keyof typeof TOUR_COPY_DEFAULTS;
export type TourCopy = Record<TourCopyKey, { title: string; text: string }>;

function textOf(block: PortableTextBlock | undefined): string {
  const children = (block as { children?: unknown } | undefined)?.children;
  if (!Array.isArray(children)) return "";
  return children.map((child) => (typeof (child as { text?: unknown }).text === "string" ? (child as { text: string }).text : "")).join("").trim();
}

/** The tour's words from the page's blocks, keyed `<step>-title` and `<step>-text`. */
export function readTourCopy(content: readonly PortableTextBlock[] | undefined): TourCopy {
  const byKey = new Map((content ?? []).map((block) => [block._key, block]));
  const copy = {} as TourCopy;
  for (const [key, fallback] of Object.entries(TOUR_COPY_DEFAULTS) as [TourCopyKey, { title: string; text: string }][]) {
    copy[key] = {
      title: textOf(byKey.get(`${key}-title`)) || fallback.title,
      text: textOf(byKey.get(`${key}-text`)) || fallback.text,
    };
  }
  return copy;
}

const block = (key: string, style: string, text: string) => ({
  _type: "block", _key: key, style, markDefs: [],
  children: [{ _type: "span", _key: `${key}-span`, text, marks: [] }],
});

/** The CMS page the playground seeds with the tour's words. */
export const PLAYGROUND_TOUR_PAGE_ENTRY = {
  id: TOUR_PAGE_SLUG,
  slug: TOUR_PAGE_SLUG,
  status: "published",
  data: {
    title: "Playground tour",
    content: (Object.entries(TOUR_COPY_DEFAULTS) as [string, { title: string; text: string }][]).flatMap(([key, words]) => [
      block(`${key}-title`, key === "intro" ? "h2" : "h3", words.title),
      block(`${key}-text`, "normal", words.text),
    ]),
  },
};
