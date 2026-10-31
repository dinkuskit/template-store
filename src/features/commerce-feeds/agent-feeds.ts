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

function agentEligible(product: AgentProductFeedFacts): boolean {
  return (
    product.product.availability.listable &&
    product.product.price !== undefined &&
    product.content.canonicalUrl.trim().length > 0 &&
    product.content.title.trim().length > 0
  );
}

function shippingSummaryLine(shipping: StorefrontShippingQuoteInput | null | undefined): string {
  if (!shipping) return "Calculated at checkout in USD minor units (cents); digital-only orders pay 0 shipping.";
  if (shipping.mode === "free") return "Free shipping ($0.00 USD; 0 minor units).";
  const flat = shipping.amount ? `$${formatMinorUnitsAsDecimal(shipping.amount)} USD (${shipping.amount.minor} minor units)` : "flat rate";
  if (shipping.freeOver) {
    return `Flat ${flat}; free on merchandise orders over $${formatMinorUnitsAsDecimal(shipping.freeOver)} USD (${shipping.freeOver.minor} minor units). Digital-only orders pay 0 shipping.`;
  }
  return `Flat ${flat}. Digital-only orders pay 0 shipping.`;
}

export function buildAgentCatalogFeed(options: StorefrontAgentFeedOptions): AgentCatalogFeed {
  const origin = options.siteOrigin.replace(/\/+$/, "");
  const products: AgentCatalogProductEntry[] = options.products
    .filter(agentEligible)
    .map((row) => {
      const money = row.product.price!;
      const aiProjection = normalizeAiProjection(row.content.aiProjection);
      const description = row.content.description?.trim();
      return {
        id: row.product.id,
        sku: row.product.sku,
        title: row.content.title.trim(),
        canonicalUrl: row.content.canonicalUrl.trim(),
        ...(description ? { description } : {}),
        imageUrls: [...(row.content.imageUrls ?? [])],
        price: {
          currency: "USD",
          minor: money.minor,
          formatted: `$${formatMinorUnitsAsDecimal(money)} USD`,
        },
        availability: {
          status: row.product.availability.status,
          sellable: row.product.availability.sellable,
        },
        fulfillment: row.product.fulfillment === "digital" ? "digital" : "physical",
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
      lines.push(
        `- [${item.title}](${item.canonicalUrl}): ${item.price.formatted} (${item.price.minor} minor units, ${item.availability.status}, SKU \`${item.sku}\`, ${item.fulfillment})${summarySuffix}`,
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
      `- Price: ${item.price.formatted} (\`minor: "${item.price.minor}"\`, \`currency: "${item.price.currency}"\`)`,
      `- Availability: \`${item.availability.status}\` (\`sellable: ${item.availability.sellable}\`)`,
      `- Fulfillment: \`${item.fulfillment}\``,
    );
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
  return [
    `# Shopping Agent & Virtual Card Contract — ${feed.storeName}`,
    "",
    `> Canonical machine-readable operating guide for autonomous shopping agents, price comparison crawlers, and single-use virtual card issuers interacting with ${feed.storeName} (${feed.siteOrigin}).`,
    "",
    "## 1. Discovery & Structured Feeds",
    `- **Concise LLM Index**: \`GET ${feed.siteOrigin}/llms.txt\``,
    `- **Full Catalog & Policy Corpus**: \`GET ${feed.siteOrigin}/llms-full.txt\``,
    `- **Live Public Catalog JSON API**: \`GET ${feed.siteOrigin}/_emdash/api/plugins/dinkus-commerce/catalog\``,
    `- **Single Item JSON API**: \`GET ${feed.siteOrigin}/_emdash/api/plugins/dinkus-commerce/catalog-item?itemId=<id>\` (or \`?pageId=<pageId>\`)`,
    `- **Google Merchant XML Feed**: \`GET ${feed.siteOrigin}/feeds/google-merchant.xml\``,
    `- **Meta Catalog CSV Feed**: \`GET ${feed.siteOrigin}/feeds/meta-catalog.csv\``,
    "",
    "## 2. Deterministic Virtual Card Sizing (`USD` Minor Units)",
    "Agents provisioning single-use virtual payment cards (Stripe Issuing, Privacy, Lithic, Ramp, or consumer agent wallets) can compute the exact payable total in USD minor units (cents) before or during checkout:",
    `- **Currency**: \`${feed.virtualCardSizing.currency}\``,
    `- **Tax**: Always \`${feed.virtualCardSizing.taxMinor}\` minor units (\`tax: { currency: "USD", minor: "0" }\`). Tax is not added at payment session creation.`,
    `- **Shipping**: ${shippingSummaryLine(feed.virtualCardSizing.shipping)}`,
    `- **Exact Total Formula**: \`${feed.virtualCardSizing.formula}\``,
    "",
    "### Checkout DOM Attributes (`/checkout`)",
    "On the `/checkout` page, `[data-checkout-breakdown]` exposes live integer minor-unit attributes alongside formatted USD strings:",
    "- `data-checkout-currency=\"USD\"`",
    "- `data-checkout-subtotal-minor=\"<integer-cents>\"`",
    "- `data-checkout-shipping-minor=\"<integer-cents>\"`",
    "- `data-checkout-tax-minor=\"0\"`",
    "- `data-checkout-total-minor=\"<integer-cents>\"`",
    "",
    "## 3. Guest Checkout API Protocol",
    "1. **Prepare Capability**: `POST /_emdash/api/plugins/dinkus-commerce/checkout/prepare` with same-origin `Origin` header (`sec-fetch-site: same-origin`). Retain `capability.capability` from the JSON response body and send it on subsequent requests via the `x-commerce-guest-capability` header.",
    "2. **Start Checkout & Freeze Pricing**: `POST /_emdash/api/plugins/dinkus-commerce/checkout/start` with `x-commerce-guest-capability`, `lines: [{ catalogItemId, quantity }]`, optional `couponCode`, and `contact` (`email`, plus `delivery` address when a line has `fulfillment: \"physical\"`).",
    "   - The response `checkout.pricing` object contains:",
    "     - `merchandiseSubtotal: { currency: \"USD\", minor: \"...\" }`",
    "     - `couponDiscount: { currency: \"USD\", minor: \"...\" }`",
    "     - `netMerchandise: { currency: \"USD\", minor: \"...\" }`",
    "     - `shipping: { mode: \"free\" | \"flat\", charge: { currency: \"USD\", minor: \"...\" } }`",
    "     - `tax: { currency: \"USD\", minor: \"0\" }`",
    "     - `finalTotal: { currency: \"USD\", minor: \"...\" }`",
    "   - Size the virtual card to `checkout.pricing.finalTotal.minor` (in USD cents) and navigate to `checkout.redirectUrl`.",
    "3. **Poll Status / Receipt**: `GET /_emdash/api/plugins/dinkus-commerce/checkout/status?attemptId=<attemptId>` with `x-commerce-guest-capability` until `checkout.state === \"paid\"` and `checkout.order.receiptId` is present.",
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
        }
      : null;

  const shippingSummaryText = shippingPolicy
    ? shippingPolicy.mode === "free"
      ? "Free shipping."
      : shippingPolicy.amount
        ? `Flat shipping: $${formatMinorUnitsAsDecimal(shippingPolicy.amount)} USD (${shippingPolicy.amount.minor} minor units).`
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
    products: enrichedProducts,
    policies: policyLinks,
    shipping,
  };
}
