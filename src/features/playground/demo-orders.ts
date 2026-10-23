/**
 * The playground's two sample orders (GrillTrack playground-commerce-until-part-2-20261022):
 * one shipped, with its practice label, and one paid and waiting to ship. They sit
 * in Commerce's orders like every other TEST order, so Ship lists them beside the
 * prospect's own. Made once per playground store; never touched after.
 */
import { PluginStorageRepository } from "emdash";
import { ORDER_NUMBERS_COLLECTION, ORDERS_COLLECTION, PAID_ORDER_SCHEMA } from "@dinkuskit/commerce";
import { BOXES, STAND_IN_STORAGE, type Label } from "../playground-plugins/dinkuskit-stand-in.js";

type Db = ConstructorParameters<typeof PluginStorageRepository>[0];
type Line = { sku: string; name: string; quantity: number; unitMinor: string };

const COMMERCE = "dinkus-commerce";
const SHIPPING_MINOR = 500;
const HOUR = 3_600_000;

const SAMPLES: { orderId: string; number: number; paidHoursAgo: number; shippedHoursAgo?: number; name: string; email: string; city: string; region: string; postalCode: string; line1: string; lines: Line[] }[] = [
  {
    orderId: "playground-sample-1001", number: 1001, paidHoursAgo: 50, shippedHoursAgo: 26,
    name: "Jordan Rivers", email: "jordan.rivers@example.com", line1: "214 Laurel Ave", city: "Asheville", region: "NC", postalCode: "28801",
    lines: [
      { sku: "DEMO-HOSTED-SHIRT", name: "Dinkus Demo Heavyweight T-Shirt", quantity: 1, unitMinor: "3200" },
      { sku: "DEMO-HOSTED-MUG", name: "Dinkus Demo Ceramic Mug", quantity: 1, unitMinor: "1800" },
    ],
  },
  {
    orderId: "playground-sample-1002", number: 1002, paidHoursAgo: 3,
    name: "Sam Okafor", email: "sam.okafor@example.com", line1: "88 Pine Street", city: "Knoxville", region: "TN", postalCode: "37902",
    lines: [
      { sku: "DEMO-HOSTED-HOODIE-M", name: "Dinkus Demo Everyday Hoodie", quantity: 1, unitMinor: "6000" },
      { sku: "DEMO-HOSTED-CAP", name: "Dinkus Demo Structured Cap", quantity: 2, unitMinor: "2400" },
    ],
  },
];

const money = (minor: number) => ({ currency: "USD", minor: String(minor) });

/** Adds the sample orders a playground store does not have yet; `items` maps each SKU to its catalog item. */
export async function ensurePlaygroundSampleOrders(db: Db, items: ReadonlyMap<string, string>, now = Date.now()): Promise<void> {
  const orders = new PluginStorageRepository<Record<string, unknown>>(db, COMMERCE, ORDERS_COLLECTION, []);
  const numbers = new PluginStorageRepository<{ next: number }>(db, COMMERCE, ORDER_NUMBERS_COLLECTION, []);
  const labels = new PluginStorageRepository<Label>(db, STAND_IN_STORAGE.pluginId, STAND_IN_STORAGE.labels, []);
  for (const sample of SAMPLES) {
    if (await orders.get(sample.orderId)) continue;
    if (!sample.lines.every((line) => items.has(line.sku))) continue;
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
      number: sample.number,
      revision: 1,
    };
    if (sample.shippedHoursAgo !== undefined) {
      const at = new Date(now - sample.shippedHoursAgo * HOUR).toISOString();
      const tracking = `TEST${sample.number}0000000`;
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
  const next = await numbers.get("next");
  const after = Math.max(...SAMPLES.map((sample) => sample.number)) + 1;
  if (!next || next.next < after) await numbers.put("next", { next: after });
}
