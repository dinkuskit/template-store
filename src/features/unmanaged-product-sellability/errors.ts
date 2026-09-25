export type UnmanagedProductSellabilityErrorCode =
  | "AVAILABILITY_REJECTED"
  | "CATALOG_REJECTED"
  | "MANAGE_STOCK_ENABLED"
  | "PROOF_INPUT_INVALID"
  | "QUANTITY_EXPOSED";

export class UnmanagedProductSellabilityError extends Error {
  readonly code: UnmanagedProductSellabilityErrorCode;

  constructor(code: UnmanagedProductSellabilityErrorCode, message: string) {
    super(message);
    this.name = "UnmanagedProductSellabilityError";
    this.code = code;
  }
}
