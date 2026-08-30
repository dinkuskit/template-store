import type {
  ActiveLocationBalanceSnapshot,
  BalanceRecord,
  InventoryCommandResult,
  InventoryReceiptV2,
  InventoryStockReceiptV2,
  InventoryStore,
  InventoryTransaction,
  ListLocationsQuery,
  ListReceiptsQuery,
  LocationBalanceBlocker,
  LocationCommit,
  LocationRecord,
  ManagedSkuCommit,
  ManagedSkuRecord,
  OpeningBalanceCommit,
  ReadManagedSkuQuery,
  ReadSkuActiveLocationSnapshotQuery,
  SkuLocationKey,
  StoredCommandResult,
  StoredOpeningBalanceConfirmation,
} from "@dinkuskit/inventory";

type StockAdjustmentCommit = Parameters<
  InventoryTransaction["commitStockAdjustment"]
>[0];
type StockAdjustmentConfirmation = Exclude<
  ReturnType<InventoryTransaction["getStockAdjustmentConfirmation"]>,
  null
>;

type StoreState = {
  balances: Map<string, BalanceRecord>;
  commands: Map<string, StoredCommandResult>;
  confirmations: Map<string, StoredOpeningBalanceConfirmation>;
  locations: Map<string, LocationRecord>;
  managedSkus: Map<string, ManagedSkuRecord>;
  managedSkuIdsByVisibleSku: Map<string, string>;
  receiptCommandIds: Map<string, string>;
  receipts: Map<string, InventoryReceiptV2>;
};

function emptyState(): StoreState {
  return {
    balances: new Map(),
    commands: new Map(),
    confirmations: new Map(),
    locations: new Map(),
    managedSkus: new Map(),
    managedSkuIdsByVisibleSku: new Map(),
    receiptCommandIds: new Map(),
    receipts: new Map(),
  };
}

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map(
    [...source].map(([key, value]) => [key, structuredClone(value)]),
  );
}

function cloneState(source: StoreState): StoreState {
  return {
    balances: cloneMap(source.balances),
    commands: cloneMap(source.commands),
    confirmations: cloneMap(source.confirmations),
    locations: cloneMap(source.locations),
    managedSkus: cloneMap(source.managedSkus),
    managedSkuIdsByVisibleSku: new Map(source.managedSkuIdsByVisibleSku),
    receiptCommandIds: new Map(source.receiptCommandIds),
    receipts: cloneMap(source.receipts),
  };
}

function balanceKey(key: SkuLocationKey): string {
  return `${key.poolId}\u0000${key.locationId}\u0000${key.skuId}`;
}

function locationKey(poolId: string, locationId: string): string {
  return `${poolId}\u0000${locationId}`;
}

function managedSkuKey(poolId: string, inventorySkuId: string): string {
  return `${poolId}\u0000${inventorySkuId}`;
}

function visibleSkuKey(poolId: string, sku: string): string {
  return `${poolId}\u0000${sku}`;
}

function receiptLocationIds(
  receipt: InventoryStockReceiptV2,
): readonly string[] {
  return receipt.effects.map((effect) => effect.locationId);
}

class MemoryInventoryTransaction implements InventoryTransaction {
  constructor(
    private readonly state: StoreState,
    private readonly poolId: string,
  ) {}

  private assertPool(candidate: string): void {
    if (candidate !== this.poolId) {
      throw new Error("A transaction cannot cross inventory pools.");
    }
  }

  getCommand<TResult extends InventoryCommandResult = InventoryCommandResult>(
    commandId: string,
  ): StoredCommandResult<TResult> | null {
    const stored = this.state.commands.get(commandId);
    return stored === undefined
      ? null
      : (structuredClone(stored) as StoredCommandResult<TResult>);
  }

  getBalance(key: SkuLocationKey): BalanceRecord | null {
    this.assertPool(key.poolId);
    const balance = this.state.balances.get(balanceKey(key));
    return balance === undefined ? null : structuredClone(balance);
  }

  getManagedSku(inventorySkuId: string): ManagedSkuRecord | null {
    const sku = this.state.managedSkus.get(
      managedSkuKey(this.poolId, inventorySkuId),
    );
    return sku === undefined ? null : structuredClone(sku);
  }

  getManagedSkuBySku(sku: string): ManagedSkuRecord | null {
    const inventorySkuId = this.state.managedSkuIdsByVisibleSku.get(
      visibleSkuKey(this.poolId, sku),
    );
    return inventorySkuId === undefined
      ? null
      : this.getManagedSku(inventorySkuId);
  }

  getLocation(locationId: string): LocationRecord | null {
    const location = this.state.locations.get(
      locationKey(this.poolId, locationId),
    );
    return location === undefined ? null : structuredClone(location);
  }

  getLocationByNameKey(nameKey: string): LocationRecord | null {
    const location = [...this.state.locations.values()].find(
      (candidate) =>
        candidate.poolId === this.poolId && candidate.nameKey === nameKey,
    );
    return location === undefined ? null : structuredClone(location);
  }

  listLocationBalanceBlockers(
    locationId: string,
  ): readonly LocationBalanceBlocker[] {
    return [...this.state.balances.values()]
      .filter(
        (balance) =>
          balance.poolId === this.poolId &&
          balance.locationId === locationId &&
          (balance.onHand.value !== "0" || balance.reserved.value !== "0"),
      )
      .map((balance) => ({
        skuId: balance.skuId,
        onHand: structuredClone(balance.onHand),
        reserved: structuredClone(balance.reserved),
      }));
  }

  getOpeningBalanceConfirmation(
    confirmationDigest: string,
  ): StoredOpeningBalanceConfirmation | null {
    const record = this.state.confirmations.get(confirmationDigest);
    return record === undefined ? null : structuredClone(record);
  }

  storeOpeningBalanceConfirmation(
    record: StoredOpeningBalanceConfirmation,
  ): void {
    this.assertPool(record.poolId);
    if (this.state.confirmations.has(record.confirmationDigest)) {
      throw new Error("Opening-balance confirmation already exists.");
    }
    this.state.confirmations.set(
      record.confirmationDigest,
      structuredClone(record),
    );
  }

  bindOpeningBalanceConfirmation(
    confirmationDigest: string,
    commandId: string,
  ): void {
    const record = this.state.confirmations.get(confirmationDigest);
    if (record === undefined || record.commandId !== null) {
      throw new Error("Opening-balance confirmation binding failed.");
    }
    this.state.confirmations.set(confirmationDigest, {
      ...record,
      commandId,
    });
  }

  getStockAdjustmentConfirmation(
    confirmationDigest: string,
  ): StockAdjustmentConfirmation | null {
    return this.getOpeningBalanceConfirmation(confirmationDigest);
  }

  storeStockAdjustmentConfirmation(record: StockAdjustmentConfirmation): void {
    this.storeOpeningBalanceConfirmation(record);
  }

  bindStockAdjustmentConfirmation(
    confirmationDigest: string,
    commandId: string,
  ): void {
    this.bindOpeningBalanceConfirmation(confirmationDigest, commandId);
  }

  storeCommandResult(record: StoredCommandResult): void {
    if (this.state.commands.has(record.commandId)) {
      throw new Error("Command result already exists.");
    }
    this.state.commands.set(record.commandId, structuredClone(record));
  }

  storeRejection(record: StoredCommandResult): void {
    this.storeCommandResult(record);
  }

  commitOpeningBalance(input: OpeningBalanceCommit): void {
    this.assertPool(input.balance.poolId);
    const key = balanceKey(input.balance);
    if (this.state.balances.has(key)) {
      throw new Error("Opening balance already exists.");
    }
    this.state.balances.set(key, structuredClone(input.balance));
    this.storeReceiptAndCommand(input.receipt, input);
  }

  commitStockAdjustment(input: StockAdjustmentCommit): void {
    this.assertPool(input.balance.poolId);
    const key = balanceKey(input.balance);
    const current = this.state.balances.get(key);
    if (current === undefined || current.version !== input.previousVersion) {
      throw new Error("Stock adjustment version drifted during commit.");
    }
    this.state.balances.set(key, structuredClone(input.balance));
    this.storeReceiptAndCommand(input.receipt, input);
  }

  commitLocation(input: LocationCommit): void {
    this.assertPool(input.location.poolId);
    const key = locationKey(input.location.poolId, input.location.locationId);
    const current = this.state.locations.get(key) ?? null;
    if (
      (input.previous === null && current !== null) ||
      (input.previous !== null && current?.version !== input.previous.version)
    ) {
      throw new Error("Location version drifted during commit.");
    }
    this.state.locations.set(key, structuredClone(input.location));
    this.state.receipts.set(
      input.receipt.receiptId,
      structuredClone(input.receipt),
    );
    this.state.receiptCommandIds.set(
      input.receipt.receiptId,
      input.commandId,
    );
    this.storeCommandResult({
      commandId: input.commandId,
      commandDigest: input.commandDigest,
      result: input.result,
    });
  }

  commitManagedSku(input: ManagedSkuCommit): void {
    this.assertPool(input.sku.poolId);
    const idKey = managedSkuKey(input.sku.poolId, input.sku.inventorySkuId);
    const skuKey = visibleSkuKey(input.sku.poolId, input.sku.sku);
    if (
      this.state.managedSkus.has(idKey) ||
      this.state.managedSkuIdsByVisibleSku.has(skuKey)
    ) {
      throw new Error("Managed SKU identity already exists.");
    }
    this.state.managedSkus.set(idKey, structuredClone(input.sku));
    this.state.managedSkuIdsByVisibleSku.set(
      skuKey,
      input.sku.inventorySkuId,
    );
    this.storeCommandResult({
      commandId: input.commandId,
      commandDigest: input.commandDigest,
      result: input.result,
    });
  }

  private storeReceiptAndCommand(
    receipt: InventoryStockReceiptV2,
    input: Readonly<{
      commandId: string;
      commandDigest: string;
      result: InventoryCommandResult;
    }>,
  ): void {
    if (this.state.receipts.has(receipt.receiptId)) {
      throw new Error("Receipt identity already exists.");
    }
    this.state.receipts.set(receipt.receiptId, structuredClone(receipt));
    this.state.receiptCommandIds.set(receipt.receiptId, input.commandId);
    this.storeCommandResult({
      commandId: input.commandId,
      commandDigest: input.commandDigest,
      result: input.result,
    });
  }
}

export class MemoryInventoryStore implements InventoryStore {
  private state = emptyState();
  private tail: Promise<void> = Promise.resolve();

  runTransaction<T>(
    poolId: string,
    operation: (transaction: InventoryTransaction) => T,
  ): Promise<T> {
    const run = this.tail.then(() => {
      const draft = cloneState(this.state);
      const result = operation(new MemoryInventoryTransaction(draft, poolId));
      this.state = draft;
      return result;
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async readBalance(key: SkuLocationKey): Promise<BalanceRecord | null> {
    await this.tail;
    const balance = this.state.balances.get(balanceKey(key));
    return balance === undefined ? null : structuredClone(balance);
  }

  async readManagedSku(
    query: ReadManagedSkuQuery,
  ): Promise<ManagedSkuRecord | null> {
    await this.tail;
    const sku = this.state.managedSkus.get(
      managedSkuKey(query.poolId, query.skuId),
    );
    return sku === undefined ? null : structuredClone(sku);
  }

  async readSkuActiveLocationSnapshot(
    query: ReadSkuActiveLocationSnapshotQuery,
  ): Promise<readonly ActiveLocationBalanceSnapshot[]> {
    await this.tail;
    return [...this.state.locations.values()]
      .filter(
        (location) =>
          location.poolId === query.poolId && location.status === "active",
      )
      .sort((left, right) => left.locationId.localeCompare(right.locationId))
      .map((location) => ({
        location: structuredClone(location),
        balance:
          this.state.balances.get(
            balanceKey({
              poolId: query.poolId,
              locationId: location.locationId,
              skuId: query.skuId,
            }),
          ) ?? null,
      }))
      .map((snapshot) => structuredClone(snapshot));
  }

  async readCommand<
    TResult extends InventoryCommandResult = InventoryCommandResult,
  >(commandId: string): Promise<StoredCommandResult<TResult> | null> {
    await this.tail;
    const stored = this.state.commands.get(commandId);
    return stored === undefined
      ? null
      : (structuredClone(stored) as StoredCommandResult<TResult>);
  }

  async readCommandByReceiptId<
    TResult extends InventoryCommandResult = InventoryCommandResult,
  >(receiptId: string): Promise<StoredCommandResult<TResult> | null> {
    await this.tail;
    const commandId = this.state.receiptCommandIds.get(receiptId);
    return commandId === undefined ? null : this.readCommand<TResult>(commandId);
  }

  async readReceipt(receiptId: string): Promise<InventoryReceiptV2 | null> {
    await this.tail;
    const receipt = this.state.receipts.get(receiptId);
    return receipt === undefined ? null : structuredClone(receipt);
  }

  async listReceipts(
    query: ListReceiptsQuery,
  ): Promise<readonly InventoryStockReceiptV2[]> {
    await this.tail;
    return [...this.state.receipts.values()]
      .filter(
        (receipt): receipt is InventoryStockReceiptV2 =>
          receipt.context.poolId === query.poolId && "effects" in receipt,
      )
      .filter(
        (receipt) =>
          query.locationId === undefined ||
          receiptLocationIds(receipt).includes(query.locationId),
      )
      .filter(
        (receipt) =>
          query.before === undefined ||
          receipt.committedAt < query.before.committedAt ||
          (receipt.committedAt === query.before.committedAt &&
            receipt.receiptId < query.before.receiptId),
      )
      .sort(
        (left, right) =>
          right.committedAt.localeCompare(left.committedAt) ||
          right.receiptId.localeCompare(left.receiptId),
      )
      .slice(0, query.limit)
      .map((receipt) => structuredClone(receipt));
  }

  async listLocations(
    query: ListLocationsQuery,
  ): Promise<readonly LocationRecord[]> {
    await this.tail;
    return [...this.state.locations.values()]
      .filter(
        (location) =>
          location.poolId === query.poolId && location.status === query.status,
      )
      .sort((left, right) => left.locationId.localeCompare(right.locationId))
      .map((location) => structuredClone(location));
  }

  async close(): Promise<void> {
    await this.tail;
  }
}
