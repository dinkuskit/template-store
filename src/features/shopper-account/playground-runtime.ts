import {
  COMMERCE_PLUGIN_ID,
  PAID_ORDER_SCHEMA,
  ORDERS_COLLECTION,
  type OrderRecord,
} from "@dinkuskit/commerce";
import {
  NATIVE_SHOPPER_ACCOUNT_STORAGE,
  bindShopperAccountRuntime,
  startShopperSignIn,
  verifyShopperSignIn,
  type ShopperAccountHostOptions,
  type ShopperEmailMessage,
} from "@dinkuskit/commerce/features/customers";
import { listOrdersForEmail, type OrdersCollection } from "@dinkuskit/commerce/features/orders";
import { PluginStorageRepository } from "emdash";

import {
  DEMO_SHOPPER_EMAIL,
  DEMO_SHOPPER_ORDER_ID,
  DEMO_SHOPPER_ORDER_NUMBER,
} from "./index.js";

type EnvLike = Record<string, unknown>;
type Db = ConstructorParameters<typeof PluginStorageRepository>[0];

export const PLAYGROUND_LEADS_DB_BINDING = "PLAYGROUND_LEADS_DB";
export const PLAYGROUND_EMAIL_BINDING = "EMAIL";
export const PLAYGROUND_DEFAULT_FROM_EMAIL = "accounts@dinkuskit.com";
export const PLAYGROUND_ORIGIN = "https://playground.dinkuskit.com";

export interface CloudflareEmailBinding {
  send(message: {
    to: string | string[];
    from: { email: string; name?: string } | string;
    subject: string;
    text?: string;
    html?: string;
    replyTo?: string;
  }): Promise<{ messageId?: string }>;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

export type CapturedProofEmail = Readonly<{
  to: string;
  subject: string;
  text: string;
  code: string | null;
  sentAt: string;
}>;

export type PlaygroundLeadRecord = Readonly<{
  email: string;
  firstVerifiedAt: string;
  lastVerifiedAt: string;
  optInSource: string;
  verificationCount: number;
}>;

const capturedProofEmails = new Map<string, CapturedProofEmail>();
const capturedProofLeads = new Map<string, PlaygroundLeadRecord>();

function extractSixDigitCode(text: string): string | null {
  const match = text.match(/\b(\d{6})\b/u);
  return match ? match[1] : null;
}

export function isLocalProofOrDemoMode(env: EnvLike = process.env): boolean {
  return (
    env.DINKUS_LOCAL_PROOF === "1" ||
    env.DINKUS_PROOF_MODE === "1" ||
    env.DINKUS_STOREFRONT_PROFILE === "proof"
  );
}

export function readCapturedProofEmail(email: string): CapturedProofEmail | null {
  return capturedProofEmails.get(email.trim().toLowerCase()) ?? null;
}

export function clearCapturedProofEmails(): void {
  capturedProofEmails.clear();
}

export function readCapturedProofLeads(): PlaygroundLeadRecord[] {
  return [...capturedProofLeads.values()];
}

export function clearCapturedProofLeads(): void {
  capturedProofLeads.clear();
}

function isEmailBinding(candidate: unknown): candidate is CloudflareEmailBinding {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as { send?: unknown }).send === "function"
  );
}

function isD1Database(candidate: unknown): candidate is D1DatabaseLike {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as { prepare?: unknown }).prepare === "function"
  );
}

export async function deliverPlaygroundShopperEmail(
  message: ShopperEmailMessage,
  env: EnvLike = process.env,
): Promise<void> {
  const activeEnv =
    (globalThis as { __dinkusPlaygroundEnv?: EnvLike }).__dinkusPlaygroundEnv ?? env;
  const recipient = message.to.trim().toLowerCase();
  const emailBinding = activeEnv[PLAYGROUND_EMAIL_BINDING];
  if (isLocalProofOrDemoMode(activeEnv)) {
    capturedProofEmails.set(recipient, {
      to: recipient,
      subject: message.subject,
      text: message.text,
      code: extractSixDigitCode(message.text),
      sentAt: new Date().toISOString(),
    });
    if (isEmailBinding(emailBinding)) {
      await emailBinding.send({
        to: message.to,
        from: { email: PLAYGROUND_DEFAULT_FROM_EMAIL, name: "DinkusKit Playground" },
        subject: message.subject,
        text: message.text,
      });
    }
    return;
  }
  if (!isEmailBinding(emailBinding)) {
    throw new Error("Outbound email transport is not configured.");
  }
  await emailBinding.send({
    to: message.to,
    from: { email: PLAYGROUND_DEFAULT_FROM_EMAIL, name: "DinkusKit Playground" },
    subject: message.subject,
    text: message.text,
  });
}

export function resolvePlaygroundAccountSiteOrigin(env: EnvLike = process.env): string {
  const activeEnv =
    (globalThis as { __dinkusPlaygroundEnv?: EnvLike }).__dinkusPlaygroundEnv ?? env;
  if (typeof activeEnv.EMDASH_SITE_URL === "string" && activeEnv.EMDASH_SITE_URL.trim() !== "") {
    return activeEnv.EMDASH_SITE_URL.trim();
  }
  if (
    activeEnv.DINKUS_LOCAL_PROOF === "1" &&
    typeof activeEnv.DINKUS_LOCAL_PROOF_SITE_URL === "string" &&
    activeEnv.DINKUS_LOCAL_PROOF_SITE_URL.trim() !== ""
  ) {
    return activeEnv.DINKUS_LOCAL_PROOF_SITE_URL.trim();
  }
  return PLAYGROUND_ORIGIN;
}

export function playgroundShopperAccountHostOptions(
  env: EnvLike = process.env,
): ShopperAccountHostOptions {
  return {
    siteUrl: resolvePlaygroundAccountSiteOrigin(env),
    storeName: "DinkusKit Store",
    sendEmail: (message: ShopperEmailMessage) => deliverPlaygroundShopperEmail(message, env),
  };
}

export async function recordVerifiedPlaygroundLead(
  email: string,
  env: EnvLike = process.env,
  nowIso = new Date().toISOString(),
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@") || normalized === DEMO_SHOPPER_EMAIL) {
    return false;
  }
  const activeEnv =
    (globalThis as { __dinkusPlaygroundEnv?: EnvLike }).__dinkusPlaygroundEnv ?? env;
  const existing = capturedProofLeads.get(normalized);
  capturedProofLeads.set(normalized, {
    email: normalized,
    firstVerifiedAt: existing?.firstVerifiedAt ?? nowIso,
    lastVerifiedAt: nowIso,
    optInSource: "playground-account-otp",
    verificationCount: (existing?.verificationCount ?? 0) + 1,
  });
  const leadsDb = activeEnv[PLAYGROUND_LEADS_DB_BINDING];
  if (!isD1Database(leadsDb)) {
    return true;
  }
  await leadsDb
    .prepare(
      `CREATE TABLE IF NOT EXISTS playground_email_leads (
        email TEXT PRIMARY KEY,
        first_verified_at TEXT NOT NULL,
        last_verified_at TEXT NOT NULL,
        opt_in_source TEXT NOT NULL,
        verification_count INTEGER NOT NULL DEFAULT 1
      )`,
    )
    .run();
  await leadsDb
    .prepare(
      `INSERT INTO playground_email_leads (
        email,
        first_verified_at,
        last_verified_at,
        opt_in_source,
        verification_count
      ) VALUES (?1, ?2, ?3, ?4, 1)
      ON CONFLICT(email) DO UPDATE SET
        last_verified_at = excluded.last_verified_at,
        verification_count = playground_email_leads.verification_count + 1`,
    )
    .bind(normalized, nowIso, nowIso, "playground-account-otp")
    .run();
  return true;
}

export async function ensureDemoShopperOrder(db: Db): Promise<void> {
  const orders = new PluginStorageRepository<OrderRecord>(
    db,
    COMMERCE_PLUGIN_ID,
    ORDERS_COLLECTION,
    [],
  );
  const existing = await orders.get(DEMO_SHOPPER_ORDER_ID);
  if (existing) return;
  const demoOrder: OrderRecord = {
    number: DEMO_SHOPPER_ORDER_NUMBER,
    revision: 1,
    paidOrder: {
      schema: PAID_ORDER_SCHEMA,
      orderId: DEMO_SHOPPER_ORDER_ID,
      receiptId: "rcpt_demo_shopper_1001",
      attemptId: "att_demo_shopper_1001",
      paymentId: "pay_demo_shopper_1001",
      paidAt: "2026-10-15T14:30:00.000Z",
      mode: "test",
      lines: [
        {
          catalogItemId: "demo-hosted-shirt",
          name: "Dinkus Demo Heavyweight T-Shirt",
          quantity: 1,
          unitPrice: { currency: "USD", minor: "3200" },
        },
      ],
      total: { currency: "USD", minor: "3800" },
      contactSnapshot: {
        schema: "dinkuskit.commerce.checkout-contact/v1",
        requirePhoneNumber: false,
        revision: null,
        contact: {
          email: DEMO_SHOPPER_EMAIL,
          phone: "+1 555 010 2400",
          delivery: {
            name: "Alex Rivera",
            line1: "742 Evergreen Terrace",
            line2: "Apt 2B",
            city: "Springfield",
            region: "OR",
            postalCode: "97477",
            country: "US",
          },
        },
      },
    },
  };
  await orders.compareAndSet(DEMO_SHOPPER_ORDER_ID, null, demoOrder);
}

export async function mintDemoShopperSession(
  db: Db,
  siteOrigin: string,
): Promise<{
  ok: true;
  capability: {
    sessionId: string;
    session: string;
    retention: "json-body";
    header: string;
    expiresAt: string;
  };
  profile: {
    email: string;
    phone: string | null;
    delivery: unknown;
  };
}> {
  await ensureDemoShopperOrder(db);
  const storage = {
    [NATIVE_SHOPPER_ACCOUNT_STORAGE.customers]: new PluginStorageRepository(
      db,
      COMMERCE_PLUGIN_ID,
      NATIVE_SHOPPER_ACCOUNT_STORAGE.customers,
      [],
    ),
    [NATIVE_SHOPPER_ACCOUNT_STORAGE.loginCodes]: new PluginStorageRepository(
      db,
      COMMERCE_PLUGIN_ID,
      NATIVE_SHOPPER_ACCOUNT_STORAGE.loginCodes,
      [],
    ),
    [NATIVE_SHOPPER_ACCOUNT_STORAGE.sessions]: new PluginStorageRepository(
      db,
      COMMERCE_PLUGIN_ID,
      NATIVE_SHOPPER_ACCOUNT_STORAGE.sessions,
      [],
    ),
    [ORDERS_COLLECTION]: new PluginStorageRepository<OrderRecord>(
      db,
      COMMERCE_PLUGIN_ID,
      ORDERS_COLLECTION,
      [],
    ),
  };
  // Clear a previous demo login code record so the instant demo sign-in button
  // works repeatedly without waiting for the 30-second email resend cooldown.
  await storage[NATIVE_SHOPPER_ACCOUNT_STORAGE.loginCodes].delete(DEMO_SHOPPER_EMAIL);
  let capturedCode: string | null = null;
  const runtime = bindShopperAccountRuntime(storage, NATIVE_SHOPPER_ACCOUNT_STORAGE, {
    runtimeSiteUrl: siteOrigin,
    constructorSiteUrl: siteOrigin,
    topLevelSiteUrl: siteOrigin,
    host: {
      siteUrl: siteOrigin,
      storeName: "DinkusKit Playground",
      sendEmail: async (message: ShopperEmailMessage) => {
        capturedCode = extractSixDigitCode(message.text);
      },
      loadOrdersForEmail: (emailKey: string) =>
        listOrdersForEmail(storage[ORDERS_COLLECTION] as unknown as OrdersCollection, emailKey),
      loadShippingCountries: async () => ({
        requirePhoneNumber: false,
        shippingCountries: ["US"],
      }),
    },
  });
  const started = await startShopperSignIn(runtime, { email: DEMO_SHOPPER_EMAIL });
  if (!started.ok || !capturedCode) {
    throw new Error("Could not initialize demo shopper session.");
  }
  const verified = await verifyShopperSignIn(runtime, {
    email: DEMO_SHOPPER_EMAIL,
    code: capturedCode,
  });
  if (!verified.ok) {
    throw new Error("Could not verify demo shopper session.");
  }
  return {
    ok: true,
    capability: verified.capability,
    profile: verified.profile,
  };
}
