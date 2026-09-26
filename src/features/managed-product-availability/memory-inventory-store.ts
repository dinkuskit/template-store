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
  ReadStockTransferInput,
  ReservationRecord,
  SkuLocationKey,
  StockReservationCommit,
  StockTransferCommit,
  StockTransferRecord,
  StoredCommandResult,
  StoredOpeningBalanceConfirmation,
} from "@dinkuskit/inventory";

type ListStockTransfersQuery = Parameters<
  InventoryStore["listStockTransfers"]
>[0];
type StoredStockTransferListPage = Awaited<
  ReturnType<InventoryStore["listStockTransfers"]>
>;

type StockAdjustmentCommit = Parameters<
  InventoryTransaction["commitStockAdjustment"]
>[0];
type StockAdjustmentConfirmation = Exclude<
  ReturnType<InventoryTransaction["getStockAdjustmentConfirmation"]>,
  null
>;

type StoreState = {
  activeReservationIdsByOrderLineKey: Map<string, string>;
  balances: Map<string, BalanceRecord>;
  commands: Map<string, StoredCommandResult>;
  confirmations: Map<string, StoredOpeningBalanceConfirmation>;
  locations: Map<string, LocationRecord>;
  managedSkus: Map<string, ManagedSkuRecord>;
  managedSkuIdsByVisibleSku: Map<string, string>;
  receiptCommandIds: Map<string, string>;
  receipts: Map<string, InventoryReceiptV2>;
  reservations: Map<string, ReservationRecord>;
  transferIdsByReferenceKey: Map<string, string>;
  transfers: Map<string, StockTransferRecord>;
};

function emptyState(): StoreState {
  return {
    activeReservationIdsByOrderLineKey: new Map(),
    balances: new Map(),
    commands: new Map(),
    confirmations: new Map(),
    locations: new Map(),
    managedSkus: new Map(),
    managedSkuIdsByVisibleSku: new Map(),
    receiptCommandIds: new Map(),
    receipts: new Map(),
    reservations: new Map(),
    transferIdsByReferenceKey: new Map(),
    transfers: new Map(),
  };
}

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map(
    [...source].map(([key, value]) => [key, structuredClone(value)]),
  );
}

function cloneState(source: StoreState): StoreState {
  return {
    activeReservationIdsByOrderLineKey: new Map(
      source.activeReservationIdsByOrderLineKey,
    ),
    balances: cloneMap(source.balances),
    commands: cloneMap(source.commands),
    confirmations: cloneMap(source.confirmations),
    locations: cloneMap(source.locations),
    managedSkus: cloneMap(source.managedSkus),
    managedSkuIdsByVisibleSku: new Map(source.managedSkuIdsByVisibleSku),
    receiptCommandIds: new Map(source.receiptCommandIds),
    receipts: cloneMap(source.receipts),
    reservations: cloneMap(source.reservations),
    transferIdsByReferenceKey: new Map(source.transferIdsByReferenceKey),
    transfers: cloneMap(source.transfers),
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

function transferKey(poolId: string, transferId: string): string {
  return `${poolId}\u0000${transferId}`;
}

function transferReferenceKey(poolId: string, referenceKey: string): string {
  return `${poolId}\u0000${referenceKey}`;
}

function reservationKey(poolId: string, reservationId: string): string {
  return `${poolId}\u0000${reservationId}`;
}

function reservationOrderLineStoreKey(
  poolId: string,
  orderLineKey: string,
): string {
  return `${poolId}\u0000${orderLineKey}`;
}

function transferSortDate(transfer: StockTransferRecord): string | null {
  switch (transfer.status) {
    case "created":
      return transfer.expectedDispatchDate;
    case "in_transit":
      return transfer.expectedArrivalDate;
    case "received":
      return transfer.receivedDate;
    case "canceled":
      return transfer.canceledAt;
  }
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

  getStockTransfer(transferId: string): StockTransferRecord | null {
    const transfer = this.state.transfers.get(
      transferKey(this.poolId, transferId),
    );
    return transfer === undefined ? null : structuredClone(transfer);
  }

  getStockTransferByReferenceKey(
    referenceKey: string,
  ): StockTransferRecord | null {
    const transferId = this.state.transferIdsByReferenceKey.get(
      transferReferenceKey(this.poolId, referenceKey),
    );
    return transferId === undefined ? null : this.getStockTransfer(transferId);
  }

  getReservation(reservationId: string): ReservationRecord | null {
    const reservation = this.state.reservations.get(
      reservationKey(this.poolId, reservationId),
    );
    return reservation === undefined ? null : structuredClone(reservation);
  }

  getActiveReservationByOrderLineKey(
    orderLineKey: string,
  ): ReservationRecord | null {
    const reservationId = this.state.activeReservationIdsByOrderLineKey.get(
      reservationOrderLineStoreKey(this.poolId, orderLineKey),
    );
    return reservationId === undefined
      ? null
      : this.getReservation(reservationId);
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
          (balance.onHand.value !== "0" ||
            balance.reserved.value !== "0" ||
            balance.outgoingTransferCommitted.value !== "0" ||
            balance.expected.value !== "0" ||
            balance.inTransit.value !== "0"),
      )
      .map((balance) => ({
        skuId: balance.skuId,
        onHand: structuredClone(balance.onHand),
        reserved: structuredClone(balance.reserved),
        outgoingTransferCommitted: structuredClone(
          balance.outgoingTransferCommitted,
        ),
        expected: structuredClone(balance.expected),
        inTransit: structuredClone(balance.inTransit),
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

  commitStockTransfer(input: StockTransferCommit): void {
    this.assertPool(input.transfer.poolId);
    for (const change of input.balances) {
      this.assertPool(change.balance.poolId);
      const key = balanceKey(change.balance);
      const current = this.state.balances.get(key) ?? null;
      if (change.previous === null) {
        if (current !== null) {
          throw new Error("Stock-transfer opening balance already exists.");
        }
      } else if (
        current === null ||
        current.version !== change.previous.version
      ) {
        throw new Error("Stock-transfer balance version drifted during commit.");
      }
      this.state.balances.set(key, structuredClone(change.balance));
    }
    const idKey = transferKey(
      input.transfer.poolId,
      input.transfer.transferId,
    );
    const currentTransfer = this.state.transfers.get(idKey) ?? null;
    if (input.previous === null) {
      if (currentTransfer !== null) {
        throw new Error("Stock transfer already exists.");
      }
    } else if (
      currentTransfer === null ||
      currentTransfer.version !== input.previous.version
    ) {
      throw new Error("Stock-transfer version drifted during commit.");
    }
    this.state.transfers.set(idKey, structuredClone(input.transfer));
    this.state.transferIdsByReferenceKey.set(
      transferReferenceKey(input.transfer.poolId, input.referenceKey),
      input.transfer.transferId,
    );
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

  commitStockReservation(input: StockReservationCommit): void {
    this.assertPool(input.reservation.poolId);
    this.assertPool(input.balance.poolId);
    const balanceId = balanceKey(input.balance);
    const currentBalance = this.state.balances.get(balanceId);
    if (
      currentBalance === undefined ||
      currentBalance.version !== input.previousBalance.version
    ) {
      throw new Error("Reservation balance version drifted during commit.");
    }
    this.state.balances.set(balanceId, structuredClone(input.balance));
    const idKey = reservationKey(
      input.reservation.poolId,
      input.reservation.reservationId,
    );
    const currentReservation = this.state.reservations.get(idKey) ?? null;
    if (input.previous === null) {
      if (currentReservation !== null) {
        throw new Error("Reservation already exists.");
      }
    } else if (
      currentReservation === null ||
      currentReservation.version !== input.previous.version
    ) {
      throw new Error("Reservation version drifted during commit.");
    }
    this.state.reservations.set(idKey, structuredClone(input.reservation));
    const lineKey = reservationOrderLineStoreKey(
      input.reservation.poolId,
      input.orderLineKey,
    );
    if (input.reservation.status === "not_shipped" ||
        input.reservation.status === "partially_packed") {
      this.state.activeReservationIdsByOrderLineKey.set(
        lineKey,
        input.reservation.reservationId,
      );
    } else {
      this.state.activeReservationIdsByOrderLineKey.delete(lineKey);
    }
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

  commitStockReservationBatch(
    input: Parameters<InventoryTransaction["commitStockReservationBatch"]>[0],
  ): void {
    for (const entry of input.balances) {
      this.assertPool(entry.balance.poolId);
      const key = balanceKey(entry.balance);
      const current = this.state.balances.get(key);
      if (current === undefined || current.version !== entry.previous.version) {
        throw new Error("Reservation balance version drifted during commit.");
      }
      this.state.balances.set(key, structuredClone(entry.balance));
    }
    for (const entry of input.reservations) {
      this.assertPool(entry.reservation.poolId);
      const key = reservationKey(entry.reservation.poolId, entry.reservation.reservationId);
      const current = this.state.reservations.get(key);
      if (current === undefined || current.version !== entry.previous.version) {
        throw new Error("Reservation version drifted during commit.");
      }
      this.state.reservations.set(key, structuredClone(entry.reservation));
      const lineKey = reservationOrderLineStoreKey(entry.reservation.poolId, entry.orderLineKey);
      if (entry.reservation.status === "not_shipped" ||
          entry.reservation.status === "partially_packed") {
        this.state.activeReservationIdsByOrderLineKey.set(lineKey, entry.reservation.reservationId);
      } else {
        this.state.activeReservationIdsByOrderLineKey.delete(lineKey);
      }
    }
    if (this.state.receipts.has(input.receipt.receiptId)) {
      throw new Error("Receipt identity already exists.");
    }
    this.state.receipts.set(input.receipt.receiptId, structuredClone(input.receipt));
    this.state.receiptCommandIds.set(input.receipt.receiptId, input.commandId);
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

  async readStockTransfer(
    query: ReadStockTransferInput,
  ): Promise<StockTransferRecord | null> {
    await this.tail;
    const transfer = this.state.transfers.get(
      transferKey(query.poolId, query.transferId),
    );
    return transfer === undefined ? null : structuredClone(transfer);
  }

  async listStockTransfers(
    query: ListStockTransfersQuery,
  ): Promise<StoredStockTransferListPage> {
    await this.tail;
    let selectedLocation: LocationRecord | null = null;
    if (query.locationId !== undefined) {
      selectedLocation =
        this.state.locations.get(
          locationKey(query.poolId, query.locationId),
        ) ?? null;
      if (selectedLocation === null || selectedLocation.status !== "active") {
        return { selectedLocation, rows: [] };
      }
    }
    const statuses =
      query.view === "open"
        ? new Set(["created", "in_transit"])
        : new Set(["received", "canceled"]);
    const direction = query.view === "open" ? 1 : -1;
    const rows = [...this.state.transfers.values()]
      .filter(
        (transfer) =>
          transfer.poolId === query.poolId && statuses.has(transfer.status),
      )
      .filter((transfer) => {
        if (query.locationId === undefined) {
          const origin = this.state.locations.get(
            locationKey(transfer.poolId, transfer.originLocationId),
          );
          const destination = this.state.locations.get(
            locationKey(transfer.poolId, transfer.destinationLocationId),
          );
          return (
            origin === undefined ||
            destination === undefined ||
            origin.status === "active" ||
            destination.status === "active"
          );
        }
        return (
          transfer.originLocationId === query.locationId ||
          transfer.destinationLocationId === query.locationId
        );
      })
      .map((transfer) => {
        const origin = this.state.locations.get(
          locationKey(transfer.poolId, transfer.originLocationId),
        );
        const destination = this.state.locations.get(
          locationKey(transfer.poolId, transfer.destinationLocationId),
        );
        if (origin === undefined || destination === undefined) {
          return null;
        }
        return {
          transfer: structuredClone(transfer),
          origin: structuredClone(origin),
          destination: structuredClone(destination),
          position: {
            sortDate: transferSortDate(transfer) ?? "",
            updatedAt: transfer.updatedAt,
            transferId: transfer.transferId,
          },
        };
      })
      .filter(
        (row): row is NonNullable<typeof row> => row !== null,
      )
      .filter((row) => {
        if (query.after === undefined) {
          return true;
        }
        const compared =
          row.position.sortDate.localeCompare(query.after.sortDate) *
            direction ||
          query.after.updatedAt.localeCompare(row.position.updatedAt) ||
          row.position.transferId.localeCompare(query.after.transferId);
        return compared > 0;
      })
      .sort(
        (left, right) =>
          left.position.sortDate.localeCompare(right.position.sortDate) *
            direction ||
          right.position.updatedAt.localeCompare(left.position.updatedAt) ||
          left.position.transferId.localeCompare(right.position.transferId),
      )
      .slice(0, query.limit);
    return { selectedLocation, rows };
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
