export type ManagedProductAvailabilityErrorCode =
  | "BOOTSTRAP_REJECTED"
  | "CATALOG_STATE_INVALID"
  | "INVENTORY_STATE_INVALID"
  | "PROOF_INPUT_INVALID"
  | "STOCK_ADJUSTMENT_REJECTED";

export class ManagedProductAvailabilityError extends Error {
  readonly code: ManagedProductAvailabilityErrorCode;

  constructor(code: ManagedProductAvailabilityErrorCode, message: string) {
    super(message);
    this.name = "ManagedProductAvailabilityError";
    this.code = code;
  }
}
