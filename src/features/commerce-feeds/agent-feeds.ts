import { formatMinorUnitsAsDecimal } from "@dinkuskit/commerce/features/structured-data";
import type { ProductFeedFacts } from "@dinkuskit/commerce/features/feeds";
import { COMMERCE_NATIVE_PLUGIN_ID } from "../commerce-catalog/installed.js";
import { COMMERCE_REGISTRY_RUNTIME_ID } from "../guest-cart/checkout-protocol.js";
import { readInstalledCommercePolicies } from "../commerce-policies/index.js";
import { STORE_TITLE } from "../store-shell/index.js";
import { canonicalUrl } from "../store-shell/structured-data.js";
import { buildInstalledCommerceFeedFacts, type CommerceFeedContext } from "./index.js";

export interface ProductAiProjection {
  readonly summary?: string;
  readonly highlights?: readonly string[];
  readonly specs?: Readonly<Record<string, string>>;
  readonly shippingSummary?: string;
  readonly returnPolicySummary?: string;
}

export type AgentProductFeedFacts = Omit<ProductFeedFacts, "product" | "content"> & {
  readonly product: ProductFeedFacts["product"] & {
    readonly fulfillment?: "physical" | "digital";
  };
  readonly content: ProductFeedFacts["content"] & {
    readonly aiProjection?: ProductAiProjection;
  };
};

export interface StorefrontPolicySummary {
  readonly slug: string;
  readonly title: string;
  readonly url: string;
  readonly body?: string;
}

export interface StorefrontShippingQuoteInput {
  readonly mode: "free" | "flat";
  readonly amount?: { readonly currency: "USD"; readonly minor: string };
  readonly freeOver?: { readonly currency: "USD"; readonly minor: string };
}

export interface StorefrontAgentFeedOptions {
  readonly storeName: string;
  readonly siteOrigin: string;
  readonly description?: string;
  readonly pluginId?: string;
  readonly checkoutBreakdownSelector?: string;
  readonly products: readonly AgentProductFeedFacts[];
  readonly policies?: readonly StorefrontPolicySummary[];
  readonly shipping?: StorefrontShippingQuoteInput | null;
}

export interface AgentCatalogProductEntry {
  readonly id: string;
  readonly sku: string;
  readonly title: string;
  readonly canonicalUrl: string;
  readonly description?: string;
  readonly imageUrls: readonly string[];
  readonly price?: {
    readonly currency: "USD";
    readonly minor: string;
    readonly formatted: string;
  };
  readonly availability: {
    readonly status: ProductFeedFacts["product"]["availability"]["status"];
    readonly sellable: boolean;
  };
  readonly fulfillment?: "physical" | "digital";
  readonly variants?: {
    readonly productId: string;
    readonly options: NonNullable<ProductFeedFacts["product"]["variants"]>["options"];
    readonly members: readonly {
      readonly catalogItemId: string;
      readonly selections: NonNullable<ProductFeedFacts["product"]["variants"]>["members"][number]["selections"];
      readonly price: {
        readonly currency: "USD";
        readonly minor: string;
        readonly formatted: string;
      };
      readonly availability: {
        readonly status: ProductFeedFacts["product"]["availability"]["status"];
        readonly sellable: boolean;
      };
      readonly fulfillment: "physical" | "digital";
    }[];
  };
  readonly brand?: string;
  readonly gtin?: string;
  readonly mpn?: string;
  readonly aiProjection?: ProductAiProjection;
}

export interface AgentCatalogFeed {
  readonly schema: "dinkuskit.commerce.agent-catalog-feed/v1";
  readonly storeName: string;
  readonly siteOrigin: string;
  readonly description?: string;
  readonly virtualCardSizing: {
    readonly currency: "USD";
    readonly taxMinor: "0";
    readonly taxPolicy: "uncollected-zero";
    readonly shipping: StorefrontShippingQuoteInput | null;
    readonly formula: "subtotalMinor - couponDiscountMinor + shippingMinor + taxMinor(0) = totalMinor";
  };
  readonly products: readonly AgentCatalogProductEntry[];
  readonly policies: readonly StorefrontPolicySummary[];
}

function normalizeAiProjection(projection: ProductAiProjection | undefined): ProductAiProjection | undefined {
  if (!projection) return undefined;
  const summary = projection.summary?.trim();
  const highlights = (projection.highlights ?? []).map((item) => item.trim()).filter(Boolean);
  const specsEntries = Object.entries(projection.specs ?? {})
    .map(([key, value]) => [key.trim(), String(value).trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0);
  const shippingSummary = projection.shippingSummary?.trim();
  const returnPolicySummary = projection.returnPolicySummary?.trim();
  if (!summary && !highlights.length && !specsEntries.length && !shippingSummary && !returnPolicySummary) {
    return undefined;
  }
  return {
    ...(summary ? { summary } : {}),
    ...(highlights.length ? { highlights } : {}),
    ...(specsEntries.length ? { specs: Object.fromEntries(specsEntries) } : {}),
    ...(shippingSummary ? { shippingSummary } : {}),
    ...(returnPolicySummary ? { returnPolicySummary } : {}),
  };
}

function hasPricedListableMember(product: AgentProductFeedFacts): boolean {
  const members = product.product.variants?.members;
  if (!members?.length) return false;
  return members.some((member) => member.availability.listable && member.price !== null && member.price !== undefined);
}

function agentEligible(product: AgentProductFeedFacts): boolean {
  return (
    product.eligibility.length > 0 &&
    product.product.availability.listable &&
    (product.product.price !== undefined || hasPricedListableMember(product)) &&
    product.content.canonicalUrl.trim().length > 0 &&
    product.content.title.trim().length > 0
  );
}

function resolveProductFulfillment(product: AgentProductFeedFacts): "physical" | "digital" | undefined {
  if (product.product.fulfillment === "physical" || product.product.fulfillment === "digital") {
    return product.product.fulfillment;
  }
  const members = product.product.variants?.members ?? [];
  if (!members.length) return undefined;
  const values = new Set(members.map((member) => member.fulfillment));
  return values.size === 1 ? [...values][0] : undefined;
}

function shippingSummaryLine(shipping: StorefrontShippingQuoteInput | null | undefined): string {
  if (!shipping) return "Calculated at checkout in USD minor units (cents); digital-only orders pay 0 shipping.";
  if (shipping.mode === "free") return "Free shipping ($0.00 USD; 0 minor units).";
  const flat = shipping.amount ? `$${formatMinorUnitsAsDecimal(shipping.amount)} USD (${shipping.amount.minor} minor units)` : "flat rate";
  if (shipping.freeOver) {
    return `Flat ${flat}; free when discounted net merchandise (netMerchandise) is at least $${formatMinorUnitsAsDecimal(shipping.freeOver)} USD (>= ${shipping.freeOver.minor} minor units, inclusive, after coupon discounts). Digital-only orders pay 0 shipping.`;
  }
  return `Flat ${flat}. Digital-only orders pay 0 shipping.`;
}

export function buildAgentCatalogFeed(options: StorefrontAgentFeedOptions): AgentCatalogFeed {
  const origin = options.siteOrigin.replace(/\/+$/, "");
  const products: AgentCatalogProductEntry[] = options.products
    .filter(agentEligible)
    .map((row) => {
      const money = row.product.price;
      const aiProjection = normalizeAiProjection(row.content.aiProjection);
      const description = row.content.description?.trim();
      const fulfillment = resolveProductFulfillment(row);
      const variantMembers = (row.product.variants?.members ?? [])
        .filter((member) => member.availability.listable && member.price !== null && member.price !== undefined)
        .map((member) => ({
          catalogItemId: member.catalogItemId,
          selections: member.selections,
          price: {
            currency: "USD" as const,
            minor: member.price!.minor,
            formatted: `$${formatMinorUnitsAsDecimal(member.price!)} USD`,
          },
          availability: {
            status: member.availability.status,
            sellable: member.availability.sellable,
          },
          fulfillment: member.fulfillment,
        }));
      return {
        id: row.product.id,
        sku: row.product.sku,
        title: row.content.title.trim(),
        canonicalUrl: row.content.canonicalUrl.trim(),
        ...(description ? { description } : {}),
        imageUrls: [...(row.content.imageUrls ?? [])],
        ...(money
          ? {
              price: {
                currency: "USD",
                minor: money.minor,
                formatted: `$${formatMinorUnitsAsDecimal(money)} USD`,
              },
            }
          : {}),
        availability: {
          status: row.product.availability.status,
          sellable: row.product.availability.sellable || variantMembers.some((member) => member.availability.sellable),
        },
        ...(fulfillment ? { fulfillment } : {}),
        ...(row.product.variants && variantMembers.length
          ? {
              variants: {
                productId: row.product.variants.productId,
                options: row.product.variants.options,
                members: variantMembers,
              },
            }
          : {}),
        ...(row.product.brand ? { brand: row.product.brand } : {}),
        ...(row.product.gtin ? { gtin: row.product.gtin } : {}),
        ...(row.product.mpn ? { mpn: row.product.mpn } : {}),
        ...(aiProjection ? { aiProjection } : {}),
      };
    });

  return {
    schema: "dinkuskit.commerce.agent-catalog-feed/v1",
    storeName: options.storeName.trim(),
    siteOrigin: origin,
    ...(options.description?.trim() ? { description: options.description.trim() } : {}),
    virtualCardSizing: {
      currency: "USD",
      taxMinor: "0",
      taxPolicy: "uncollected-zero",
      shipping: options.shipping ?? null,
      formula: "subtotalMinor - couponDiscountMinor + shippingMinor + taxMinor(0) = totalMinor",
    },
    products,
    policies: [...(options.policies ?? [])],
  };
}

export function buildStorefrontLlmsTxt(options: StorefrontAgentFeedOptions): string {
  const feed = buildAgentCatalogFeed(options);
  const lines: string[] = [
    `# ${feed.storeName}`,
    "",
    `> ${feed.description ?? `${feed.storeName} storefront powered by DinkusKit Commerce on EmDash CMS.`}`,
    "",
    "## Storefront & Agent Discovery",
    `- [Full Catalog & Policy Corpus (llms-full.txt)](${feed.siteOrigin}/llms-full.txt): Complete product specs, AI projections, store policies, and checkout contract.`,
    `- [Shopping Agent & Virtual Card Guide (agents.md)](${feed.siteOrigin}/agents.md): Machine-readable guest checkout API and single-use virtual card sizing instructions.`,
    `- [Storefront Home](${feed.siteOrigin}/): Public HTML storefront.`,
    `- [Google Merchant Feed](${feed.siteOrigin}/feeds/google-merchant.xml): RSS 2.0 XML product feed.`,
    `- [Meta Catalog Feed](${feed.siteOrigin}/feeds/meta-catalog.csv): CSV product feed.`,
    "",
    `## Products (${feed.products.length})`,
  ];

  if (feed.products.length === 0) {
    lines.push("- No public products are currently listed.");
  } else {
    for (const item of feed.products) {
      const blurb = item.aiProjection?.summary ?? item.description ?? "";
      const summarySuffix = blurb ? ` — ${blurb}` : "";
      const priceLabel = item.price
        ? `${item.price.formatted} (${item.price.minor} minor units)`
        : item.variants?.members.length
          ? (() => {
              const lowest = item.variants.members.reduce((min, candidate) =>
                BigInt(candidate.price.minor) < BigInt(min.price.minor) ? candidate : min
              );
              return `from ${lowest.price.formatted} (${item.variants.members.length} variants)`;
            })()
          : "see options";
      const fulfillmentPart = item.fulfillment ? `, ${item.fulfillment}` : "";
      lines.push(
        `- [${item.title}](${item.canonicalUrl}): ${priceLabel}, ${item.availability.status}, SKU \`${item.sku}\`${fulfillmentPart}${summarySuffix}`,
      );
    }
  }

  if (feed.policies.length > 0) {
    lines.push("", "## Store Policies");
    for (const policy of feed.policies) {
      lines.push(`- [${policy.title}](${policy.url})`);
    }
  }

  lines.push(
    "",
    "## Checkout & Virtual Card Sizing",
    `- Currency: \`${feed.virtualCardSizing.currency}\` (integer minor units / cents)`,
    `- Tax: \`${feed.virtualCardSizing.taxMinor}\` minor units (\`taxPolicy: ${feed.virtualCardSizing.taxPolicy}\`)`,
    `- Shipping: ${shippingSummaryLine(feed.virtualCardSizing.shipping)}`,
    `- Formula: \`${feed.virtualCardSizing.formula}\``,
    "",
  );
  return lines.join("\n");
}

export function buildStorefrontLlmsFullTxt(options: StorefrontAgentFeedOptions): string {
  const feed = buildAgentCatalogFeed(options);
  const lines: string[] = [
    buildStorefrontLlmsTxt(options).trimEnd(),
    "",
    "---",
    "",
    "## Detailed Product Projections",
  ];

  for (const item of feed.products) {
    lines.push(
      "",
      `### ${item.title}`,
      `- Canonical URL: ${item.canonicalUrl}`,
      `- Product ID: \`${item.id}\``,
      `- SKU: \`${item.sku}\``,
    );
    if (item.price) {
      lines.push(`- Price: ${item.price.formatted} (\`minor: "${item.price.minor}"\`, \`currency: "${item.price.currency}"\`)`);
    }
    lines.push(`- Availability: \`${item.availability.status}\` (\`sellable: ${item.availability.sellable}\`)`);
    if (item.fulfillment) {
      lines.push(`- Fulfillment: \`${item.fulfillment}\``);
    }
    if (item.variants?.members.length) {
      lines.push(`- Variants (${item.variants.members.length}):`);
      for (const member of item.variants.members) {
        const sel = member.selections.map((s) => `${s.optionLabel}: ${s.valueLabel}`).join(", ");
        lines.push(
          `  - \`catalogItemId: "${member.catalogItemId}"\` (${sel || "default"}): ${member.price.formatted} (\`minor: "${member.price.minor}"\`), \`${member.availability.status}\`, \`sellable: ${member.availability.sellable}\`, \`fulfillment: "${member.fulfillment}"\``,
        );
      }
    }
    if (item.brand) lines.push(`- Brand: ${item.brand}`);
    if (item.gtin) lines.push(`- GTIN: \`${item.gtin}\``);
    if (item.mpn) lines.push(`- MPN: \`${item.mpn}\``);
    if (item.aiProjection?.summary) {
      lines.push(`- Summary: ${item.aiProjection.summary}`);
    } else if (item.description) {
      lines.push(`- Description: ${item.description}`);
    }
    if (item.aiProjection?.highlights?.length) {
      lines.push(`- Highlights: ${item.aiProjection.highlights.join("; ")}`);
    }
    if (item.aiProjection?.specs && Object.keys(item.aiProjection.specs).length > 0) {
      const specsText = Object.entries(item.aiProjection.specs)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
      lines.push(`- Specs: ${specsText}`);
    }
    if (item.aiProjection?.shippingSummary) {
      lines.push(`- Shipping Note: ${item.aiProjection.shippingSummary}`);
    }
    if (item.aiProjection?.returnPolicySummary) {
      lines.push(`- Return Policy Note: ${item.aiProjection.returnPolicySummary}`);
    }
  }

  if (feed.policies.length > 0) {
    lines.push("", "---", "", "## Store Policies Corpus");
    for (const policy of feed.policies) {
      lines.push("", `### ${policy.title}`, `Canonical URL: ${policy.url}`);
      if (policy.body?.trim()) {
        lines.push("", policy.body.trim());
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function buildStorefrontAgentsMd(options: StorefrontAgentFeedOptions): string {
  const feed = buildAgentCatalogFeed(options);
  const pluginId = options.pluginId?.trim() || "r_gshdrqaldna3r7sn";
  const pluginBase = `${feed.siteOrigin}/_emdash/api/plugins/${pluginId}`;
  const domSelector = options.checkoutBreakdownSelector?.trim();
  const domLines = domSelector
    ? [
        "",
        "### Pre-Start Checkout DOM Estimate Attributes (`/checkout`)",
        `On the \`/checkout\` page, \`${domSelector}\` exposes browser-side pre-start **estimate** attributes in integer minor units alongside formatted USD strings (reflecting cart line subtotals and the base flat/free shipping rate before Commerce applies coupons, free-shipping thresholds, or authoritative start pricing):`,
        "- `data-checkout-currency=\"USD\"`",
        "- `data-checkout-subtotal-minor=\"<estimated-subtotal-cents>\"`",
        "- `data-checkout-shipping-minor=\"<estimated-shipping-cents>\"`",
        "- `data-checkout-tax-minor=\"0\"`",
        "- `data-checkout-total-minor=\"<estimated-total-cents>\"`",
        "- **Important**: Treat these DOM attributes strictly as pre-start browser estimates (for example, a physical 5000-cent basket with a 500-cent flat rate publishes `data-checkout-total-minor=\"5500\"` in the DOM estimate even when a 5000-cent free-shipping threshold applies at start). Provision single-use virtual cards exclusively from Commerce's authoritative frozen `data.checkout.pricing.finalTotal.minor` returned by `POST .../checkout/guest/start`.",
      ]
    : [];
  return [
    `# Shopping Agent & Virtual Card Contract — ${feed.storeName}`,
    "",
    `> Canonical machine-readable operating guide for autonomous shopping agents, price comparison crawlers, and single-use virtual card issuers interacting with ${feed.storeName} (${feed.siteOrigin}).`,
    "",
    "## 1. Discovery & Structured Feeds",
    `- **Concise LLM Index**: \`GET ${feed.siteOrigin}/llms.txt\``,
    `- **Full Catalog & Policy Corpus**: \`GET ${feed.siteOrigin}/llms-full.txt\``,
    `- **Cart Item Snapshot JSON API**: \`GET ${feed.siteOrigin}/api/guest-cart/snapshot?ids=<id1,id2>\` (returns live price, sellability, and fulfillment for up to 24 catalog item IDs)`,
    `- **Google Merchant XML Feed**: \`GET ${feed.siteOrigin}/feeds/google-merchant.xml\``,
    `- **Meta Catalog CSV Feed**: \`GET ${feed.siteOrigin}/feeds/meta-catalog.csv\``,
    "",
    "## 2. Deterministic Virtual Card Sizing (`USD` Minor Units)",
    "Agents provisioning single-use virtual payment cards (Stripe Issuing, Privacy, Lithic, Ramp, or consumer agent wallets) must set the final card limit exclusively from Commerce's authoritative frozen `data.checkout.pricing.finalTotal.minor` returned by `POST .../checkout/guest/start` (and can pre-estimate totals in USD minor units before starting checkout using the rules below):",
    `- **Currency**: \`${feed.virtualCardSizing.currency}\``,
    `- **Tax**: Always \`${feed.virtualCardSizing.taxMinor}\` minor units (\`tax: { currency: "USD", minor: "0" }\`). Tax is not added at payment session creation.`,
    `- **Shipping**: ${shippingSummaryLine(feed.virtualCardSizing.shipping)}`,
    `- **Exact Total Formula**: \`${feed.virtualCardSizing.formula}\``,
    ...domLines,
    "",
    "## 3. Guest Checkout API Protocol",
    `For direct plugin calls (\`POST ${pluginBase}/checkout/guest/*\`), verify HTTP status 200, the EmDash transport wrapper \`success === true\`, and Commerce's \`data.ok === true\` before reading \`data\`. For the storefront status route (\`POST ${feed.siteOrigin}/api/checkout/status\`), the response is unwrapped (\`{ ok: true, capabilityId, checkout }\`): verify HTTP status 200 and top-level \`ok === true\`, then read \`checkout\` directly (or normalize both envelopes via \`payload = body.success === true ? body.data : body\`).`,
    `1. **Prepare Capability**: \`POST ${pluginBase}/checkout/guest/prepare\` with an empty JSON body \`{}\` and same-origin \`Origin\` header (\`sec-fetch-site: same-origin\`). Retain the capability token string at \`data.capability.capability\` from the JSON response and send it on subsequent requests via the \`x-commerce-guest-capability\` header. Also inspect \`data.contactRequirements.requirePhoneNumber\` to determine whether \`contact.phone\` is required.`,
    `2. **Start Checkout & Freeze Pricing**: \`POST ${pluginBase}/checkout/guest/start\` with header \`x-commerce-guest-capability: <token>\`, \`lines: [{ catalogItemId, quantity }]\` (for products with options, use the chosen sellable member's \`catalogItemId\` from \`variants.members\`), optional \`couponCode\` on self-hosted stores only (omit \`couponCode\` on Registry stores, where coupon codes are refused with \`COUPON_UNAVAILABLE\`), and \`contact\`:`,
    "   - `email` (required)",
    "   - `phone` (required when `data.contactRequirements.requirePhoneNumber === true`)",
    "   - `billing`: required on every checkout (including digital-only orders) with `{ name, line1, line2?, city, region?, postalCode, country }` (`country` as 2-letter ISO code)",
    "   - `delivery`: required when a line has `fulfillment: \"physical\"`, with `{ name, line1, line2?, city, region?, postalCode, country }` in a shipping destination supported by the store (published in the storefront shipping policy; US delivery requires a valid 2-letter state or full state name in `region`)",
    "   - The response `data.checkout.pricing` object contains:",
    "     - `merchandiseSubtotal: { currency: \"USD\", minor: \"...\" }`",
    "     - `couponDiscount: { currency: \"USD\", minor: \"...\" }`",
    "     - `netMerchandise: { currency: \"USD\", minor: \"...\" }`",
    "     - `shipping: { mode: \"free\" | \"flat\", charge: { currency: \"USD\", minor: \"...\" } }`",
    "     - `tax: { currency: \"USD\", minor: \"0\" }`",
    "     - `finalTotal: { currency: \"USD\", minor: \"...\" }`",
    "   - Size the virtual card to `data.checkout.pricing.finalTotal.minor` (in USD cents) and navigate to `data.checkout.redirectUrl` (when `data.checkout.state === \"pending\"` and `data.checkout.redirectUrl` is non-null; zero-total checkouts complete immediately with `data.checkout.state === \"paid\"`).",
    `3. **Poll Status / Receipt**: \`POST ${pluginBase}/checkout/guest/status\` (wrapped \`data.checkout\`) or storefront wrapper \`POST ${feed.siteOrigin}/api/checkout/status\` (top-level \`checkout\`; normalized below as \`payload = body.success === true ? body.data : body\`) with header \`x-commerce-guest-capability: <token>\` and JSON body \`{}\` (or \`{ "attemptId": "<payload.checkout.attemptId>" }\`). Bound pending-status checks (at most 5 checks per attempt):`,
    "   - When `payload.checkout.state === \"paid\"`, read `payload.checkout.order` (`orderId`, `receiptId`, `lines`, `total`, `pricing`).",
    "   - When `payload.checkout.state === \"recoverable-failure\"`, do not treat the attempt as released or issue a fresh `checkout/guest/start`; preserve the active `attemptId`, stop tight polling, and if `payload.checkout.redirectUrl` is a valid Stripe Checkout URL (`https://checkout.stripe.com/...`), resume hosted payment at that `redirectUrl` for the same attempt.",
    "   - When `payload.checkout.state === \"released-retry\"` and `payload.checkout.retryAfter === payload.checkout.attemptId` (authoritative release fence), stop polling the released attempt; retain the existing `x-commerce-guest-capability` token and issue a successor `POST .../checkout/guest/start` before polling the new attempt.",
    "",
  ].join("\n");
}

export async function buildInstalledStorefrontAgentFeedOptions(
  context: CommerceFeedContext,
): Promise<StorefrontAgentFeedOptions> {
  const facts = await buildInstalledCommerceFeedFacts(context);
  const pluginId =
    process.env.DINKUS_CATALOG_PROFILE === "native-development"
      ? COMMERCE_NATIVE_PLUGIN_ID
      : COMMERCE_REGISTRY_RUNTIME_ID;
  const policies = await readInstalledCommercePolicies(
    { runtime: context.runtime, request: context.request },
    pluginId,
  ).catch(() => null);
  const origin = context.site?.origin ?? new URL(context.request.url).origin;

  const shippingPolicy = policies?.shipping;
  const shipping: StorefrontShippingQuoteInput | null =
    shippingPolicy && (shippingPolicy.mode === "free" || shippingPolicy.mode === "flat")
      ? {
          mode: shippingPolicy.mode,
          ...(shippingPolicy.amount ? { amount: shippingPolicy.amount } : {}),
          ...(shippingPolicy.freeOver ? { freeOver: shippingPolicy.freeOver } : {}),
        }
      : null;

  const shippingSummaryText = shippingPolicy
    ? shippingPolicy.mode === "free"
      ? "Free shipping."
      : shippingPolicy.amount
        ? shippingPolicy.freeOver
          ? `Flat shipping: $${formatMinorUnitsAsDecimal(shippingPolicy.amount)} USD (${shippingPolicy.amount.minor} minor units); free when discounted net merchandise (netMerchandise) is at least $${formatMinorUnitsAsDecimal(shippingPolicy.freeOver)} USD (>= ${shippingPolicy.freeOver.minor} minor units, inclusive, after coupon discounts).`
          : `Flat shipping: $${formatMinorUnitsAsDecimal(shippingPolicy.amount)} USD (${shippingPolicy.amount.minor} minor units).`
        : "Configured shipping rate."
    : undefined;

  const returnSummaryText = policies?.returns
    ? policies.returns.returnPolicyCategory === "MerchantReturnNotPermitted"
      ? "Returns are not accepted."
      : policies.returns.merchantReturnDays !== undefined
        ? `${policies.returns.merchantReturnDays}-day return window.`
        : "Store return policy applies."
    : undefined;

  const enrichedProducts: AgentProductFeedFacts[] = facts.map((item) => ({
    ...item,
    content: {
      ...item.content,
      aiProjection: {
        ...(item.content.description ? { summary: item.content.description } : {}),
        ...(shippingSummaryText ? { shippingSummary: shippingSummaryText } : {}),
        ...(returnSummaryText ? { returnPolicySummary: returnSummaryText } : {}),
      },
    },
  }));

  const policyLinks: StorefrontPolicySummary[] = [
    {
      slug: "shipping",
      title: "Shipping policy",
      url: canonicalUrl("/shipping", context.site, context.request.url),
      ...(shippingSummaryText ? { body: shippingSummaryText } : {}),
    },
    {
      slug: "returns",
      title: "Returns policy",
      url: canonicalUrl("/returns", context.site, context.request.url),
      ...(returnSummaryText ? { body: returnSummaryText } : {}),
    },
  ];

  return {
    storeName: STORE_TITLE,
    siteOrigin: origin,
    pluginId,
    checkoutBreakdownSelector: "[data-checkout-breakdown]",
    products: enrichedProducts,
    policies: policyLinks,
    shipping,
  };
}
