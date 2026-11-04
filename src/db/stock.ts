import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./index";
import {
  auditLogs,
  locations,
  stockCounts,
  stockBalances,
  stockMovements,
  stockReservations,
  movementTypeEnum,
} from "./schema";

type StockTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class StockCountLockError extends Error {
  constructor() {
    super("Lokasi sedang menjalani stock opname.");
    this.name = "StockCountLockError";
  }
}

const movementTypeSchema = z.enum(movementTypeEnum.enumValues).exclude(["reserve"]);

const movementInputSchema = z
  .object({
    warehouseId: z.string().uuid(),
    variantId: z.string().uuid(),
    type: movementTypeSchema,
    quantity: z.string().regex(/^\d{1,11}(?:\.\d{1,3})?$/),
    fromLocationId: z.string().uuid().optional(),
    toLocationId: z.string().uuid().optional(),
    referenceType: z.string().max(80).optional(),
    referenceId: z.string().uuid().optional(),
    reason: z.string().max(500).optional(),
    createdBy: z.string().uuid().optional(),
  })
  .superRefine((movement, context) => {
    if (!movement.fromLocationId && !movement.toLocationId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pergerakan harus memiliki lokasi asal atau tujuan.",
        path: ["toLocationId"],
      });
    }

    if (
      movement.fromLocationId &&
      movement.fromLocationId === movement.toLocationId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Lokasi asal dan tujuan tidak boleh sama.",
        path: ["toLocationId"],
      });
    }

    const quantityInMilliUnits = toMilliUnits(movement.quantity);
    if (!Number.isSafeInteger(quantityInMilliUnits) || quantityInMilliUnits <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Jumlah pergerakan harus lebih besar dari nol.",
        path: ["quantity"],
      });
    }
  });

export type StockMovementInput = z.input<typeof movementInputSchema>;

export function parseStockMovementInput(input: StockMovementInput) {
  return movementInputSchema.parse(input);
}

function toMilliUnits(quantity: string) {
  const [whole, fraction = ""] = quantity.split(".");
  return Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
}

export function hasUnreservedStock(
  onHand: string,
  reserved: string,
  quantity: string,
) {
  return toMilliUnits(onHand) - toMilliUnits(reserved) >= toMilliUnits(quantity);
}

export async function recordStockMovement(
  rawInput: StockMovementInput,
  activeTransaction?: StockTransaction,
) {
  const input = parseStockMovementInput(rawInput);
  const locationIds = [input.fromLocationId, input.toLocationId].filter(
    (id): id is string => id !== undefined,
  );

  const record = async (transaction: StockTransaction) => {
    const validLocations = await transaction
      .select({ id: locations.id, type: locations.type })
      .from(locations)
      .where(
        and(
          eq(locations.warehouseId, input.warehouseId),
          inArray(locations.id, locationIds),
        ),
      )
      .orderBy(asc(locations.id))
      .for("update");

    if (validLocations.length !== locationIds.length) {
      throw new Error("Lokasi tidak ditemukan di gudang yang dipilih.");
    }

    const [activeCount] = await transaction
      .select({ id: stockCounts.id })
      .from(stockCounts)
      .where(
        and(
          eq(stockCounts.warehouseId, input.warehouseId),
          inArray(stockCounts.locationId, locationIds),
          inArray(stockCounts.status, ["counting", "review"]),
        ),
      )
      .limit(1);
    if (activeCount) throw new StockCountLockError();

    const locationTypeById = new Map(
      validLocations.map((location) => [location.id, location.type]),
    );
    const sourceType = input.fromLocationId
      ? locationTypeById.get(input.fromLocationId)
      : undefined;
    const destinationType = input.toLocationId
      ? locationTypeById.get(input.toLocationId)
      : undefined;

    switch (input.type) {
      case "receipt":
        if (input.fromLocationId || destinationType !== "quarantine") {
          throw new Error("Penerimaan barang harus masuk ke lokasi karantina.");
        }
        break;
      case "qc_release":
      case "putaway":
        if (sourceType !== "quarantine" || destinationType !== "storage") {
          throw new Error("Barang lulus QC harus dipindahkan dari karantina ke penyimpanan.");
        }
        break;
      case "qc_fail":
        if (sourceType !== "quarantine" || destinationType !== "reject") {
          throw new Error("Barang gagal QC harus dipindahkan dari karantina ke lokasi reject.");
        }
        break;
      case "transfer":
      case "pick":
        if (!input.fromLocationId || !input.toLocationId) {
          throw new Error("Transfer dan picking harus memiliki lokasi asal dan tujuan.");
        }
        break;
      case "ship":
        if (destinationType || sourceType !== "storage") {
          throw new Error("Pengiriman hanya dapat mengurangi stok dari lokasi penyimpanan.");
        }
        break;
      case "return_in":
        if (input.fromLocationId || destinationType !== "return") {
          throw new Error("Barang retur harus masuk ke lokasi retur.");
        }
        break;
      case "scrap":
        if (input.toLocationId || sourceType !== "reject") {
          throw new Error("Barang reject hanya dapat dihapus stoknya dari lokasi reject.");
        }
        break;
      case "adjust":
        if (!input.reason?.trim()) {
          throw new Error("Penyesuaian stok wajib memiliki alasan.");
        }
        break;
    }

    const balanceKeys = locationIds.map((locationId) => ({
      warehouseId: input.warehouseId,
      locationId,
      variantId: input.variantId,
    }));

    await transaction
      .insert(stockBalances)
      .values(balanceKeys)
      .onConflictDoNothing();

    const balances = await transaction
      .select({
        id: stockBalances.id,
        locationId: stockBalances.locationId,
        quantity: stockBalances.quantity,
      })
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.warehouseId, input.warehouseId),
          eq(stockBalances.variantId, input.variantId),
          inArray(stockBalances.locationId, locationIds),
        ),
      )
      .orderBy(asc(stockBalances.locationId))
      .for("update");

    const sourceBalance = balances.find(
      (balance) => balance.locationId === input.fromLocationId,
    );

    if (
      input.fromLocationId &&
      (!sourceBalance ||
        toMilliUnits(sourceBalance.quantity) < toMilliUnits(input.quantity))
    ) {
      throw new Error("Stok di lokasi asal tidak mencukupi.");
    }

    if (input.type === "adjust" && sourceType === "storage") {
      const [reservationTotal] = await transaction
        .select({
          quantity: sql<string>`coalesce(sum(${stockReservations.quantity}), 0)`,
        })
        .from(stockReservations)
        .where(
          and(
            eq(stockReservations.warehouseId, input.warehouseId),
            eq(stockReservations.locationId, input.fromLocationId!),
            eq(stockReservations.variantId, input.variantId),
            sql`${stockReservations.releasedAt} IS NULL`,
          ),
        );
      if (
        !hasUnreservedStock(
          sourceBalance!.quantity,
          reservationTotal.quantity,
          input.quantity,
        )
      ) {
        throw new Error("Penyesuaian tidak boleh mengurangi stok yang sudah direservasi.");
      }
    }

    const [movement] = await transaction
      .insert(stockMovements)
      .values({
        warehouseId: input.warehouseId,
        variantId: input.variantId,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        quantity: input.quantity,
        type: input.type,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reason: input.reason,
        createdBy: input.createdBy,
      })
      .returning();

    if (input.fromLocationId) {
      const [updatedSource] = await transaction
        .update(stockBalances)
        .set({
          quantity: sql`${stockBalances.quantity} - ${input.quantity}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stockBalances.id, sourceBalance!.id),
            gte(stockBalances.quantity, input.quantity),
          ),
        )
        .returning({ id: stockBalances.id });

      if (!updatedSource) {
        throw new Error("Stok berubah selama transaksi; pergerakan dibatalkan.");
      }
    }

    if (input.toLocationId) {
      await transaction
        .update(stockBalances)
        .set({
          quantity: sql`${stockBalances.quantity} + ${input.quantity}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stockBalances.warehouseId, input.warehouseId),
            eq(stockBalances.locationId, input.toLocationId),
            eq(stockBalances.variantId, input.variantId),
          ),
        );
    }

    await transaction.insert(auditLogs).values({
      userId: input.createdBy,
      action: "stock_movement",
      entity: "stock_movement",
      entityId: movement.id,
      after: {
        type: input.type,
        variantId: input.variantId,
        fromLocationId: input.fromLocationId ?? null,
        toLocationId: input.toLocationId ?? null,
        quantity: input.quantity,
        reason: input.reason ?? null,
      },
    });

    return movement;
  };

  return activeTransaction ? record(activeTransaction) : db.transaction(record);
}
