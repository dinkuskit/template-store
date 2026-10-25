import { AsyncLocalStorage } from "node:async_hooks";
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

import { playgroundNow } from "../playground-checkout/binding-auth.js";
import { readTrustedReturnOrigin } from "../playground-checkout/index.js";
import {
  DEMO_SHOPPER_EMAIL,
  DEMO_SHOPPER_ORDER_ID,
  DEMO_SHOPPER_ORDER_NUMBER,
} from "./index.js";

type EnvLike = Record<string, unknown>;
type Db = ConstructorParameters<typeof PluginStorageRepository>[0];

export const PLAYGROUND_LEADS_DB_BINDING = "PLAYGROUND_LEADS_DB";
export const PLAYGROUND_LEADS_DO_NAME = "dinkuskit:playground:verified-leads";
export const PLAYGROUND_EMAIL_BINDING = "EMAIL";
export const PLAYGROUND_DEFAULT_FROM_EMAIL = "accounts@dinkuskit.com";
export const PLAYGROUND_ORIGIN = "https://playground.dinkuskit.com";
export const PLAYGROUND_ACCOUNT_ORIGIN_ENV = "DINKUS_PLAYGROUND_ACCOUNT_ORIGIN";
export const DEMO_SHOPPER_SESSION_ID = "csess_demo_shopper";
export const PRE_UPGRADE_SHOPPER_ORDER_ID = "ord_pre_upgrade_1000";
export const PRE_UPGRADE_SHOPPER_ORDER_NUMBER = 1002;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

type ShopperAccountRequestContext = Readonly<{
  requestOrigin: string;
  env: EnvLike;
}>;

type GlobalShopperAccountProofState = {
  __dinkusShopperRequestContext?: AsyncLocalStorage<ShopperAccountRequestContext>;
  __dinkusCapturedProofEmails?: Map<string, CapturedProofEmail>;
  __dinkusCapturedProofLeads?: Map<string, PlaygroundLeadRecord>;
};

const globalProofState = globalThis as unknown as GlobalShopperAccountProofState;

const requestContext =
  globalProofState.__dinkusShopperRequestContext ??
  (globalProofState.__dinkusShopperRequestContext =
    new AsyncLocalStorage<ShopperAccountRequestContext>());

export function withShopperAccountRequest<T>(
  requestOrigin: string,
  env: EnvLike,
  run: () => T,
): T {
  return requestContext.run({ requestOrigin, env }, run);
}

function resolveActiveEnv(env: EnvLike = process.env): EnvLike {
  return (
    requestContext.getStore()?.env ??
    (globalThis as { __dinkusPlaygroundEnv?: EnvLike }).__dinkusPlaygroundEnv ??
    env
  );
}

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

export interface LeadsDurableObjectStubLike {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; changes?: number }>;
}

export interface LeadsDurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): LeadsDurableObjectStubLike;
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

const capturedProofEmails =
  globalProofState.__dinkusCapturedProofEmails ??
  (globalProofState.__dinkusCapturedProofEmails = new Map<string, CapturedProofEmail>());
const capturedProofLeads =
  globalProofState.__dinkusCapturedProofLeads ??
  (globalProofState.__dinkusCapturedProofLeads = new Map<string, PlaygroundLeadRecord>());

function extractSixDigitCode(text: string): string | null {
  const match = text.match(/\b(\d{6})\b/u);
  return match ? match[1] : null;
}

export function isLocalProofOrDemoMode(env: EnvLike = process.env): boolean {
  const activeEnv = resolveActiveEnv(env);
  return (
    activeEnv.DINKUS_LOCAL_PROOF === "1" ||
    activeEnv.DINKUS_PROOF_MODE === "1" ||
    activeEnv.DINKUS_STOREFRONT_PROFILE === "proof"
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

function isLeadsDurableObjectNamespace(
  candidate: unknown,
): candidate is LeadsDurableObjectNamespaceLike {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as { idFromName?: unknown }).idFromName === "function" &&
    typeof (candidate as { get?: unknown }).get === "function"
  );
}

export function isPlaygroundLeadStorageConfigured(env: EnvLike = process.env): boolean {
  const activeEnv = resolveActiveEnv(env);
  const leadsDb = activeEnv[PLAYGROUND_LEADS_DB_BINDING];
  if (isD1Database(leadsDb) || isLeadsDurableObjectNamespace(leadsDb)) {
    return true;
  }
  return isLocalProofOrDemoMode(activeEnv);
}

/**
 * Sends a transactional OTP email through Cloudflare's native Email Service
 * (`send_email` binding `EMAIL`). Cloudflare Workers' `SendEmail.send()`
 * natively accepts the structured `EmailMessageBuilder` JSON payload
 * (`{ to, from, subject, text }`, see Cloudflare Email Service / `send_email`
 * binding docs), without requiring `cloudflare:email` `EmailMessage` MIME
 * wrapping.
 */
export async function deliverPlaygroundShopperEmail(
  message: ShopperEmailMessage,
  env: EnvLike = process.env,
): Promise<void> {
  const activeEnv = resolveActiveEnv(env);
  const recipient = message.to.trim().toLowerCase();
  const emailBinding = activeEnv[PLAYGROUND_EMAIL_BINDING];
  if (isLocalProofOrDemoMode(activeEnv)) {
    capturedProofEmails.set(recipient, {
      to: recipient,
      subject: message.subject,
      text: message.text,
      code: extractSixDigitCode(message.text),
      sentAt: new Date(playgroundNow(activeEnv)).toISOString(),
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

function parseBareOrigin(raw: unknown, allowLoopbackHttp: boolean): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const url = new URL(raw.trim());
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && allowLoopbackHttp && LOOPBACK_HOSTS.has(url.hostname)) {
      return url.origin;
    }
    return null;
  } catch {
    return null;
  }
}

export function resolvePlaygroundAccountSiteOrigin(
  env: EnvLike = process.env,
): string | undefined {
  const activeEnv = resolveActiveEnv(env);
  const trustedSiteUrl = readTrustedReturnOrigin(activeEnv);
  if (trustedSiteUrl) {
    return trustedSiteUrl;
  }
  if (isLocalProofOrDemoMode(activeEnv)) {
    const localProofOrigin =
      parseBareOrigin(activeEnv.DINKUS_LOCAL_PROOF_SITE_URL, true) ??
      parseBareOrigin(activeEnv.EMDASH_SITE_URL, true);
    if (localProofOrigin) {
      return localProofOrigin;
    }
  }
  const configuredAccountOrigin = activeEnv[PLAYGROUND_ACCOUNT_ORIGIN_ENV];
  if (typeof configuredAccountOrigin === "string") {
    const bareHttps = parseBareOrigin(configuredAccountOrigin.trim(), false);
    if (bareHttps) {
      return bareHttps;
    }
  }
  return undefined;
}

/**
 * True on a Playground PR preview (pr-N.playground.dinkuskit.com). Commerce
 * pins shopper accounts to the playground's own origin, so a preview can only
 * say accounts are unavailable there.
 */
export function isPlaygroundPreviewHost(
  requestUrl: URL,
  trustedOrigin: string | undefined,
): boolean {
  if (!trustedOrigin) return false;
  try {
    const trusted = new URL(trustedOrigin);
    return (
      requestUrl.origin !== trusted.origin &&
      requestUrl.hostname.endsWith(`.${trusted.hostname}`)
    );
  } catch {
    return false;
  }
}

export function playgroundShopperAccountHostOptions(
  env: EnvLike = process.env,
  fallbackSiteUrl?: string,
): ShopperAccountHostOptions {
  return {
    get siteUrl() {
      return resolvePlaygroundAccountSiteOrigin(env) ?? fallbackSiteUrl;
    },
    get topLevelSiteUrl() {
      return resolvePlaygroundAccountSiteOrigin(env) ?? fallbackSiteUrl;
    },
    storeName: "DinkusKit Store",
    now: () => Math.floor(playgroundNow(resolveActiveEnv(env)) / 1000),
    sendEmail: (message: ShopperEmailMessage) => deliverPlaygroundShopperEmail(message, env),
  };
}

const LEADS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS playground_email_leads (
  email TEXT PRIMARY KEY,
  first_verified_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  opt_in_source TEXT NOT NULL,
  verification_count INTEGER NOT NULL DEFAULT 1
)`;

export async function recordVerifiedPlaygroundLead(
  email: string,
  env: EnvLike = process.env,
  nowIso?: string,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@") || normalized === DEMO_SHOPPER_EMAIL) {
    return false;
  }
  const activeEnv = resolveActiveEnv(env);
  const timestamp = nowIso ?? new Date(playgroundNow(activeEnv)).toISOString();
  const leadsDb = activeEnv[PLAYGROUND_LEADS_DB_BINDING];

  if (isD1Database(leadsDb)) {
    await leadsDb.prepare(LEADS_TABLE_DDL).run();
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
      .bind(normalized, timestamp, timestamp, "playground-account-otp")
      .run();
    if (isLocalProofOrDemoMode(activeEnv)) {
      const existing = capturedProofLeads.get(normalized);
      capturedProofLeads.set(normalized, {
        email: normalized,
        firstVerifiedAt: existing?.firstVerifiedAt ?? timestamp,
        lastVerifiedAt: timestamp,
        optInSource: "playground-account-otp",
        verificationCount: (existing?.verificationCount ?? 0) + 1,
      });
    }
    return true;
  }

  if (isLeadsDurableObjectNamespace(leadsDb)) {
    const stub = leadsDb.get(leadsDb.idFromName(PLAYGROUND_LEADS_DO_NAME));
    await stub.query(LEADS_TABLE_DDL);
    await stub.query(
      `INSERT INTO playground_email_leads (
        email,
        first_verified_at,
        last_verified_at,
        opt_in_source,
        verification_count
      ) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(email) DO UPDATE SET
        last_verified_at = excluded.last_verified_at,
        verification_count = playground_email_leads.verification_count + 1`,
      [normalized, timestamp, timestamp, "playground-account-otp"],
    );
    if (isLocalProofOrDemoMode(activeEnv)) {
      const existing = capturedProofLeads.get(normalized);
      capturedProofLeads.set(normalized, {
        email: normalized,
        firstVerifiedAt: existing?.firstVerifiedAt ?? timestamp,
        lastVerifiedAt: timestamp,
        optInSource: "playground-account-otp",
        verificationCount: (existing?.verificationCount ?? 0) + 1,
      });
    }
    return true;
  }

  if (isLocalProofOrDemoMode(activeEnv)) {
    const existing = capturedProofLeads.get(normalized);
    capturedProofLeads.set(normalized, {
      email: normalized,
      firstVerifiedAt: existing?.firstVerifiedAt ?? timestamp,
      lastVerifiedAt: timestamp,
      optInSource: "playground-account-otp",
      verificationCount: (existing?.verificationCount ?? 0) + 1,
    });
    return true;
  }

  throw new Error("Durable playground lead database (PLAYGROUND_LEADS_DB) is not configured.");
}

export async function readVerifiedPlaygroundLeads(
  env: EnvLike = process.env,
): Promise<PlaygroundLeadRecord[]> {
  const activeEnv = resolveActiveEnv(env);
  const leadsDb = activeEnv[PLAYGROUND_LEADS_DB_BINDING];
  const selectSql = `SELECT
    email,
    first_verified_at AS firstVerifiedAt,
    last_verified_at AS lastVerifiedAt,
    opt_in_source AS optInSource,
    verification_count AS verificationCount
  FROM playground_email_leads
  ORDER BY email ASC`;

  if (isD1Database(leadsDb)) {
    await leadsDb.prepare(LEADS_TABLE_DDL).run();
    const res = await leadsDb.prepare(selectSql).all<Record<string, unknown>>();
    return (res.results ?? []).map((row) => ({
      email: String(row.email ?? ""),
      firstVerifiedAt: String(row.firstVerifiedAt ?? row.first_verified_at ?? ""),
      lastVerifiedAt: String(row.lastVerifiedAt ?? row.last_verified_at ?? ""),
      optInSource: String(row.optInSource ?? row.opt_in_source ?? ""),
      verificationCount: Number(row.verificationCount ?? row.verification_count ?? 0),
    }));
  }

  if (isLeadsDurableObjectNamespace(leadsDb)) {
    const stub = leadsDb.get(leadsDb.idFromName(PLAYGROUND_LEADS_DO_NAME));
    await stub.query(LEADS_TABLE_DDL);
    const res = await stub.query(selectSql);
    return (res.rows ?? []).map((row) => ({
      email: String(row.email ?? ""),
      firstVerifiedAt: String(row.firstVerifiedAt ?? row.first_verified_at ?? ""),
      lastVerifiedAt: String(row.lastVerifiedAt ?? row.last_verified_at ?? ""),
      optInSource: String(row.optInSource ?? row.opt_in_source ?? ""),
      verificationCount: Number(row.verificationCount ?? row.verification_count ?? 0),
    }));
  }

  if (isLocalProofOrDemoMode(activeEnv)) {
    return readCapturedProofLeads();
  }

  return [];
}

export async function revokeShopperSessionById(db: Db, sessionId: string): Promise<void> {
  if (!sessionId) return;
  const sessions = new PluginStorageRepository(
    db,
    COMMERCE_PLUGIN_ID,
    NATIVE_SHOPPER_ACCOUNT_STORAGE.sessions,
    [],
  );
  await sessions.delete(sessionId);
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

export async function ensurePreUpgradeShopperOrder(db: Db): Promise<void> {
  const orders = new PluginStorageRepository<OrderRecord>(
    db,
    COMMERCE_PLUGIN_ID,
    ORDERS_COLLECTION,
    [],
  );
  const existing = await orders.get(PRE_UPGRADE_SHOPPER_ORDER_ID);
  if (existing) return;
  const preUpgradeOrder: OrderRecord = {
    number: PRE_UPGRADE_SHOPPER_ORDER_NUMBER,
    revision: 1,
    paidOrder: {
      schema: PAID_ORDER_SCHEMA,
      orderId: PRE_UPGRADE_SHOPPER_ORDER_ID,
      receiptId: "rcpt_pre_upgrade_1000",
      attemptId: "att_pre_upgrade_1000",
      paymentId: "pay_pre_upgrade_1000",
      paidAt: "2026-10-10T10:00:00.000Z",
      mode: "test",
      lines: [
        {
          catalogItemId: "demo-hosted-cap",
          name: "Dinkus Demo Canvas Cap",
          quantity: 1,
          unitPrice: { currency: "USD", minor: "1800" },
        },
      ],
      total: { currency: "USD", minor: "2400" },
      contactSnapshot: {
        schema: "dinkuskit.commerce.checkout-contact/v1",
        requirePhoneNumber: false,
        revision: null,
        contact: {
          email: DEMO_SHOPPER_EMAIL,
          phone: "+1 555 010 1999",
          delivery: {
            name: "Alex Rivera",
            line1: "100 Pre-Upgrade Way",
            city: "Springfield",
            region: "OR",
            postalCode: "97477",
            country: "US",
          },
        },
      },
    },
  };
  await orders.compareAndSet(PRE_UPGRADE_SHOPPER_ORDER_ID, null, preUpgradeOrder);
}

export async function mintDemoShopperSession(
  db: Db,
  siteOrigin: string,
  env: EnvLike = process.env,
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
  const activeEnv = resolveActiveEnv(env);
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
  // Clear prior demo login code and fixed demo session record so the
  // instant demo sign-in button works repeatedly and overwrites one bounded
  // session slot instead of accumulating unbounded session rows per visitor.
  await storage[NATIVE_SHOPPER_ACCOUNT_STORAGE.loginCodes].delete(DEMO_SHOPPER_EMAIL);
  await storage[NATIVE_SHOPPER_ACCOUNT_STORAGE.sessions].delete(DEMO_SHOPPER_SESSION_ID);
  let capturedCode: string | null = null;
  const runtime = bindShopperAccountRuntime(storage, NATIVE_SHOPPER_ACCOUNT_STORAGE, {
    runtimeSiteUrl: siteOrigin,
    constructorSiteUrl: siteOrigin,
    topLevelSiteUrl: siteOrigin,
    host: {
      siteUrl: siteOrigin,
      storeName: "DinkusKit Playground",
      now: () => Math.floor(playgroundNow(activeEnv) / 1000),
      createSessionId: () => DEMO_SHOPPER_SESSION_ID,
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
