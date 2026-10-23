/**
 * The playground's two sample orders (GrillTrack playground-commerce-until-part-2-20261022):
 * one shipped, with its practice label, and one paid and waiting to ship. They sit
 * in Commerce's orders like every other TEST order, so Ship lists them beside the
 * prospect's own. Each takes the next number no order in the store has, skipping
 * the numbers the shopper account demo's own orders use (#1001 and #1002), which
 * it may add before or after. Made once per playground store; never touched after.
 */
import { PluginStorageRepository } from "emdash";
import { ORDER_NUMBERS_COLLECTION, ORDERS_COLLECTION, PAID_ORDER_SCHEMA } from "@dinkuskit/commerce";
import { BOXES, STAND_IN_STORAGE, type Label } from "../playground-plugins/dinkuskit-stand-in.js";
import { DEMO_SHOPPER_ORDER_NUMBER } from "../shopper-account/index.js";
import { PRE_UPGRADE_SHOPPER_ORDER_NUMBER } from "../shopper-account/playground-runtime.js";

type Db = ConstructorParameters<typeof PluginStorageRepository>[0];
type Line = { sku: string; name: string; quantity: number; unitMinor: string };

const COMMERCE = "dinkus-commerce";
const SHIPPING_MINOR = 500;
const HOUR = 3_600_000;

const RESERVED_NUMBERS = [DEMO_SHOPPER_ORDER_NUMBER, PRE_UPGRADE_SHOPPER_ORDER_NUMBER];
const FIRST_NUMBER = 1001;

const SAMPLES: { orderId: string; paidHoursAgo: number; shippedHoursAgo?: number; name: string; email: string; city: string; region: string; postalCode: string; line1: string; lines: Line[] }[] = [
  {
    orderId: "playground-sample-shipped", paidHoursAgo: 50, shippedHoursAgo: 26,
    name: "Jordan Rivers", email: "jordan.rivers@example.com", line1: "214 Laurel Ave", city: "Asheville", region: "NC", postalCode: "28801",
    lines: [
      { sku: "DEMO-HOSTED-SHIRT", name: "Dinkus Demo Heavyweight T-Shirt", quantity: 1, unitMinor: "3200" },
      { sku: "DEMO-HOSTED-MUG", name: "Dinkus Demo Ceramic Mug", quantity: 1, unitMinor: "1800" },
    ],
  },
  {
    orderId: "playground-sample-paid", paidHoursAgo: 3,
    name: "Sam Okafor", email: "sam.okafor@example.com", line1: "88 Pine Street", city: "Knoxville", region: "TN", postalCode: "37902",
    lines: [
      { sku: "DEMO-HOSTED-HOODIE-M", name: "Dinkus Demo Everyday Hoodie", quantity: 1, unitMinor: "6000" },
      { sku: "DEMO-HOSTED-CAP", name: "Dinkus Demo Structured Cap", quantity: 2, unitMinor: "2400" },
    ],
  },
];

/** The sample orders' ids, so the welcome card can tell them from the visitor's own orders. */
export const PLAYGROUND_SAMPLE_ORDER_IDS: readonly string[] = SAMPLES.map((sample) => sample.orderId);

const money = (minor: number) => ({ currency: "USD", minor: String(minor) });

/** Adds the sample orders a playground store does not have yet; `items` maps each SKU to its catalog item. */
export async function ensurePlaygroundSampleOrders(db: Db, items: ReadonlyMap<string, string>, now = Date.now()): Promise<void> {
  const orders = new PluginStorageRepository<Record<string, unknown>>(db, COMMERCE, ORDERS_COLLECTION, []);
  const numbers = new PluginStorageRepository<{ next: number }>(db, COMMERCE, ORDER_NUMBERS_COLLECTION, []);
  const labels = new PluginStorageRepository<Label>(db, STAND_IN_STORAGE.pluginId, STAND_IN_STORAGE.labels, []);
  const seedable = SAMPLES.filter((sample) => sample.lines.every((line) => items.has(line.sku)));
  const present = await orders.getMany(seedable.map((sample) => sample.orderId));
  if (seedable.every((sample) => present.has(sample.orderId))) return;
  const taken = new Set<number>(RESERVED_NUMBERS);
  let cursor: string | undefined;
  do {
    const page = await orders.query({ limit: 100, ...(cursor ? { cursor } : {}) });
    for (const row of page.items) if (typeof row.data.number === "number") taken.add(row.data.number);
    cursor = page.cursor;
  } while (cursor);
  const counter = await numbers.get("next");
  let number = Math.max(FIRST_NUMBER, counter?.next ?? FIRST_NUMBER);
  for (const sample of seedable) {
    if (present.has(sample.orderId)) continue;
    while (taken.has(number)) number += 1;
    taken.add(number);
    const merchandise = sample.lines.reduce((sum, line) => sum + Number(line.unitMinor) * line.quantity, 0);
    const paidAt = new Date(now - sample.paidHoursAgo * HOUR).toISOString();
    const delivery = { name: sample.name, line1: sample.line1, city: sample.city, region: sample.region, postalCode: sample.postalCode, country: "US" };
    const record: Record<string, unknown> = {
      paidOrder: {
        schema: PAID_ORDER_SCHEMA,
        orderId: sample.orderId,
        receiptId: `${sample.orderId}-receipt`,
        attemptId: `${sample.orderId}-attempt`,
        paidAt,
        mode: "test",
        lines: sample.lines.map((line) => ({ catalogItemId: items.get(line.sku)!, name: line.name, quantity: line.quantity, unitPrice: money(Number(line.unitMinor)) })),
        total: money(merchandise + SHIPPING_MINOR),
        contactSnapshot: { schema: "dinkuskit.commerce.checkout-contact/v1", contact: { email: sample.email, delivery }, requirePhoneNumber: false, revision: null },
      },
      number,
      revision: 1,
    };
    if (sample.shippedHoursAgo !== undefined) {
      const at = new Date(now - sample.shippedHoursAgo * HOUR).toISOString();
      const tracking = `TEST${number}0000000`;
      const box = BOXES[0]!;
      await labels.put(`practice_${sample.orderId}`, {
        labelId: `practice_${sample.orderId}`, orderId: sample.orderId, version: 1, test: true, service: "GA", box, weightOz: 20,
        carrier: "USPS", tracking, status: "bought", createdAt: at, cancelledAt: null, practice: true, priceCents: null, refund: null, delivery: null,
      });
      record.revision = 2;
      record.completed = { at, carrier: "USPS", tracking };
    }
    await orders.put(sample.orderId, record);
  }
  // The prospect's own first order comes after the samples.
  while (taken.has(number)) number += 1;
  if (!counter || counter.next < number) await numbers.put("next", { next: number });
}
