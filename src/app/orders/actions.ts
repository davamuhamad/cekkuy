"use server";

import { randomBytes } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  auditLogs,
  codPayments,
  locations,
  packingInspections,
  packingScans,
  productVariants,
  salesOrderItems,
  salesOrders,
  stockBalances,
  stockCounts,
  stockReservations,
  users,
} from "@/db/schema";
import { recordStockMovement, StockCountLockError } from "@/db/stock";
import { getUserWarehouse, requireRoles, requireUser } from "@/lib/auth";

const orderSchema = z.object({
  resellerId: z.string().uuid().optional(),
  trackingNumber: z.string().trim().min(3).max(120),
  senderStore: z.string().trim().max(160),
  isCod: z.enum(["yes", "no"]),
  codAmount: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/).optional(),
  shipBy: z.string().optional(),
  variantIds: z.array(z.string().uuid()).min(1).max(30),
  quantities: z.array(z.string().regex(/^\d{1,11}(?:\.\d{1,3})?$/)).min(1).max(30),
});

function milliUnits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
}

function returnToOrders(error: string): never {
  redirect(`/orders/new?error=${error}`);
}

export async function createSalesOrderAction(formData: FormData) {
  const user = await requireUser();
  const isReseller = user.role === "reseller";
  if (!isReseller && !["admin", "warehouse_manager", "online_ops"].includes(user.role)) {
    redirect("/?error=forbidden");
  }
  const parsed = orderSchema.safeParse({
    resellerId: formData.get("resellerId") || undefined,
    trackingNumber: formData.get("trackingNumber"),
    senderStore: formData.get("senderStore") ?? "",
    isCod: formData.get("isCod"),
    codAmount: formData.get("codAmount") || undefined,
    shipBy: formData.get("shipBy") || undefined,
    variantIds: formData.getAll("variantId"),
    quantities: formData.getAll("quantity"),
  });
  if (
    !parsed.success ||
    parsed.data.variantIds.length !== parsed.data.quantities.length ||
    parsed.data.quantities.some((quantity) => milliUnits(quantity) <= 0) ||
    new Set(parsed.data.variantIds).size !== parsed.data.variantIds.length ||
    (parsed.data.isCod === "yes" &&
      (!parsed.data.codAmount || Number(parsed.data.codAmount) <= 0))
  ) {
    returnToOrders("invalid");
  }

  const warehouseId = await getUserWarehouse(user.userId);
  const resellerId = isReseller ? user.userId : parsed.data.resellerId;
  if (!resellerId) returnToOrders("reseller");

  const [reseller] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, resellerId))
    .limit(1);
  if (!reseller || reseller.role !== "reseller") returnToOrders("reseller");

  const variants = await db
    .select({
      id: productVariants.id,
      sku: productVariants.sku,
      resellerPrice: productVariants.resellerPrice,
    })
    .from(productVariants)
    .where(and(inArray(productVariants.id, parsed.data.variantIds), eq(productVariants.isActive, true)));
  if (variants.length !== parsed.data.variantIds.length) returnToOrders("variants");

  const trackingNumber = parsed.data.trackingNumber.toUpperCase();
  const duplicate = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(and(eq(salesOrders.channel, isReseller ? `reseller:${resellerId}` : "manual"), eq(salesOrders.trackingNumber, trackingNumber)))
    .limit(1);
  if (duplicate.length) returnToOrders("duplicate");

  const shipBy = parsed.data.shipBy ? new Date(`${parsed.data.shipBy}T23:59:59`) : null;
  if (shipBy && !Number.isFinite(shipBy.getTime())) returnToOrders("invalid");
  const channel = isReseller ? `reseller:${resellerId}` : "manual";

  try {
    await db.transaction(async (transaction) => {
      const storageLocations = await transaction
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.warehouseId, warehouseId), eq(locations.type, "storage")));
      if (!storageLocations.length) throw new Error("Lokasi penyimpanan belum tersedia.");
      const storageIds = storageLocations.map((location) => location.id);

      const balances = await transaction
        .select({
          id: stockBalances.id,
          locationId: stockBalances.locationId,
          variantId: stockBalances.variantId,
          quantity: stockBalances.quantity,
        })
        .from(stockBalances)
        .where(
          and(
            eq(stockBalances.warehouseId, warehouseId),
            inArray(stockBalances.locationId, storageIds),
            inArray(stockBalances.variantId, parsed.data.variantIds),
          ),
        )
        .orderBy(asc(stockBalances.id))
        .for("update");

      const reservations = await transaction
        .select({
          locationId: stockReservations.locationId,
          variantId: stockReservations.variantId,
          quantity: sql<string>`sum(${stockReservations.quantity})`,
        })
        .from(stockReservations)
        .where(
          and(
            eq(stockReservations.warehouseId, warehouseId),
            inArray(stockReservations.locationId, storageIds),
            inArray(stockReservations.variantId, parsed.data.variantIds),
            isNull(stockReservations.releasedAt),
          ),
        )
        .groupBy(stockReservations.locationId, stockReservations.variantId);
      const reservedByLocation = new Map(
        reservations.map((reservation) => [
          `${reservation.locationId}:${reservation.variantId}`,
          milliUnits(reservation.quantity),
        ]),
      );

      const allocations = new Map<string, { locationId: string; quantity: string }[]>();
      for (let index = 0; index < parsed.data.variantIds.length; index += 1) {
        const variantId = parsed.data.variantIds[index];
        let remaining = milliUnits(parsed.data.quantities[index]);
        const sources = balances.filter((balance) => balance.variantId === variantId);
        const variantAllocations: { locationId: string; quantity: string }[] = [];
        for (const balance of sources) {
          const free =
            milliUnits(balance.quantity) -
            (reservedByLocation.get(`${balance.locationId}:${variantId}`) ?? 0);
          if (free <= 0) continue;
          const amount = Math.min(free, remaining);
          if (amount > 0) {
            variantAllocations.push({
              locationId: balance.locationId,
              quantity: (amount / 1000).toFixed(3),
            });
            remaining -= amount;
          }
          if (remaining === 0) break;
        }
        if (remaining > 0) throw new Error("Stok tersedia tidak cukup untuk salah satu SKU.");
        allocations.set(variantId, variantAllocations);
      }

      const orderCode = `SO-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
      const [order] = await transaction
        .insert(salesOrders)
        .values({
          warehouseId,
          resellerId,
          channel,
          externalOrderId: orderCode,
          trackingNumber,
          senderStore: parsed.data.senderStore || null,
          isCod: parsed.data.isCod === "yes",
          codAmount: parsed.data.isCod === "yes" ? parsed.data.codAmount : null,
          shipBy,
        })
        .returning({ id: salesOrders.id });

      const items = await transaction
        .insert(salesOrderItems)
        .values(
          parsed.data.variantIds.map((variantId, index) => ({
            orderId: order.id,
            variantId,
            quantity: parsed.data.quantities[index],
            unitPrice: variants.find((variant) => variant.id === variantId)!.resellerPrice,
          })),
        )
        .returning({ id: salesOrderItems.id, variantId: salesOrderItems.variantId });

      for (const item of items) {
        for (const allocation of allocations.get(item.variantId) ?? []) {
          await transaction.insert(stockReservations).values({
            warehouseId,
            locationId: allocation.locationId,
            variantId: item.variantId,
            orderItemId: item.id,
            quantity: allocation.quantity,
          });
        }
      }
      if (parsed.data.isCod === "yes") {
        await transaction.insert(codPayments).values({
          orderId: order.id,
          expectedAmount: parsed.data.codAmount!,
        });
      }
      await transaction.insert(auditLogs).values({
        userId: user.userId,
        action: "sales_order_created",
        entity: "sales_order",
        entityId: order.id,
        after: { orderCode, trackingNumber, resellerId, itemCount: items.length },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Stok tersedia tidak cukup untuk salah satu SKU.") {
      returnToOrders("stock");
    }
    if (error instanceof Error && error.message === "Lokasi penyimpanan belum tersedia.") {
      returnToOrders("location");
    }
    throw error;
  }

  revalidatePath("/");
  revalidatePath("/orders");
  revalidatePath("/inventory");
  redirect(isReseller ? "/portal?created=1" : "/orders?created=1");
}

const scanSchema = z.object({
  orderId: z.string().uuid(),
  barcode: z.string().trim().min(1).max(80),
  quantity: z.string().regex(/^\d{1,11}(?:\.\d{1,3})?$/),
});

export async function startPickingAction(formData: FormData) {
  const user = await requireRoles(["admin", "warehouse_manager", "warehouse_staff"]);
  const orderId = z.string().uuid().safeParse(formData.get("orderId"));
  if (!orderId.success) redirect("/orders");
  const warehouseId = await getUserWarehouse(user.userId);
  const result = await db.transaction(async (transaction) => {
    const [order] = await transaction
      .select({ id: salesOrders.id, status: salesOrders.status })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, orderId.data),
          eq(salesOrders.warehouseId, warehouseId),
        ),
      )
      .for("update")
      .limit(1);
    if (!order || order.status !== "awaiting_pick") return "state" as const;

    const reservedLocations = await transaction
      .select({ id: locations.id })
      .from(stockReservations)
      .innerJoin(
        salesOrderItems,
        eq(stockReservations.orderItemId, salesOrderItems.id),
      )
      .innerJoin(locations, eq(stockReservations.locationId, locations.id))
      .where(
        and(
          eq(salesOrderItems.orderId, order.id),
          isNull(stockReservations.releasedAt),
        ),
      )
      .orderBy(asc(locations.id))
      .for("update");
    const locationIds = [...new Set(reservedLocations.map((location) => location.id))];
    if (!locationIds.length) return "state" as const;

    const [activeCount] = await transaction
      .select({ id: stockCounts.id })
      .from(stockCounts)
      .where(
        and(
          inArray(stockCounts.locationId, locationIds),
          inArray(stockCounts.status, ["counting", "review"]),
        ),
      )
      .limit(1);
    if (activeCount) return "count_active" as const;

    await transaction
      .update(salesOrders)
      .set({ status: "picking", statusUpdatedAt: new Date(), updatedAt: new Date() })
      .where(eq(salesOrders.id, order.id));
    return "started" as const;
  });
  if (result === "count_active") {
    redirect(`/orders/${orderId.data}?error=count_active`);
  }
  if (result !== "started") redirect(`/orders/${orderId.data}?error=state`);
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId.data}`);
  redirect(`/orders/${orderId.data}?picking=1`);
}

export async function cancelSalesOrderAction(formData: FormData) {
  const user = await requireUser();
  if (
    user.role !== "reseller" &&
    !["admin", "warehouse_manager", "online_ops"].includes(user.role)
  ) {
    redirect("/?error=forbidden");
  }
  const orderId = z.string().uuid().safeParse(formData.get("orderId"));
  if (!orderId.success) redirect(user.role === "reseller" ? "/portal" : "/orders");
  const warehouseId =
    user.role === "reseller" ? undefined : await getUserWarehouse(user.userId);

  const cancelled = await db.transaction(async (transaction) => {
    const [order] = await transaction
      .select({
        id: salesOrders.id,
        resellerId: salesOrders.resellerId,
        warehouseId: salesOrders.warehouseId,
        status: salesOrders.status,
        isCod: salesOrders.isCod,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId.data))
      .for("update")
      .limit(1);
    if (
      !order ||
      (warehouseId && order.warehouseId !== warehouseId) ||
      (user.role === "reseller" && order.resellerId !== user.userId) ||
      !["awaiting_pick", "picking"].includes(order.status)
    ) {
      return false;
    }

    const [scanned] = await transaction
      .select({
        quantity: sql<string>`coalesce(sum(${packingScans.quantity}), 0)`,
      })
      .from(packingScans)
      .innerJoin(
        salesOrderItems,
        eq(packingScans.orderItemId, salesOrderItems.id),
      )
      .where(eq(salesOrderItems.orderId, order.id));
    if (milliUnits(scanned.quantity) > 0) return false;

    const now = new Date();
    const [updated] = await transaction
      .update(salesOrders)
      .set({ status: "cancelled", statusUpdatedAt: now, updatedAt: now })
      .where(
        and(
          eq(salesOrders.id, order.id),
          inArray(salesOrders.status, ["awaiting_pick", "picking"]),
        ),
      )
      .returning({ id: salesOrders.id });
    if (!updated) return false;

    const items = await transaction
      .select({ id: salesOrderItems.id })
      .from(salesOrderItems)
      .where(eq(salesOrderItems.orderId, order.id));
    if (items.length) {
      await transaction
        .update(stockReservations)
        .set({ releasedAt: now, updatedAt: now })
        .where(
          and(
            inArray(
              stockReservations.orderItemId,
              items.map((item) => item.id),
            ),
            isNull(stockReservations.releasedAt),
          ),
        );
    }
    if (order.isCod) {
      await transaction
        .update(codPayments)
        .set({
          status: "no_collection",
          notes: "Pesanan dibatalkan sebelum serah-terima kurir.",
          updatedBy: user.userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(codPayments.orderId, order.id),
            eq(codPayments.status, "pending"),
          ),
        );
    }
    await transaction.insert(auditLogs).values({
      userId: user.userId,
      action: "sales_order_cancelled",
      entity: "sales_order",
      entityId: order.id,
      before: { status: order.status },
      after: { status: "cancelled", reservationsReleased: true },
    });
    return true;
  });

  if (!cancelled) {
    redirect(
      user.role === "reseller"
        ? "/portal?error=locked"
        : `/orders/${orderId.data}?error=cancel`,
    );
  }
  revalidatePath("/orders");
  revalidatePath("/inventory");
  revalidatePath("/portal");
  revalidatePath("/billing");
  redirect(
    user.role === "reseller"
      ? "/portal?cancelled=1"
      : `/orders/${orderId.data}?cancelled=1`,
  );
}

export async function recordPackingScanAction(formData: FormData) {
  const user = await requireRoles(["admin", "warehouse_manager", "warehouse_staff"]);
  const parsed = scanSchema.safeParse({
    orderId: formData.get("orderId"),
    barcode: formData.get("barcode"),
    quantity: formData.get("quantity") || "1",
  });
  if (!parsed.success || milliUnits(parsed.data.quantity) <= 0) redirect("/orders?error=scan");
  const warehouseId = await getUserWarehouse(user.userId);

  await db.transaction(async (transaction) => {
    const [order] = await transaction
      .select({ id: salesOrders.id, status: salesOrders.status })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, parsed.data.orderId), eq(salesOrders.warehouseId, warehouseId)))
      .for("update")
      .limit(1);
    if (!order || order.status !== "picking") throw new Error("Pesanan tidak sedang dalam tahap picking.");

    const [item] = await transaction
      .select({
        id: salesOrderItems.id,
        quantity: salesOrderItems.quantity,
        sku: productVariants.sku,
        barcode: productVariants.barcode,
      })
      .from(salesOrderItems)
      .innerJoin(productVariants, eq(salesOrderItems.variantId, productVariants.id))
      .where(
        and(
          eq(salesOrderItems.orderId, order.id),
          sql`(${productVariants.sku} = ${parsed.data.barcode.toUpperCase()} OR ${productVariants.barcode} = ${parsed.data.barcode})`,
        ),
      )
      .for("update")
      .limit(1);
    if (!item) throw new Error("SKU ini tidak terdapat dalam pesanan.");

    const [scanned] = await transaction
      .select({ quantity: sql<string>`coalesce(sum(${packingScans.quantity}), 0)` })
      .from(packingScans)
      .where(eq(packingScans.orderItemId, item.id));
    if (
      milliUnits(scanned?.quantity ?? "0") + milliUnits(parsed.data.quantity) >
      milliUnits(item.quantity)
    ) {
      throw new Error("Jumlah scan melebihi jumlah item pada pesanan.");
    }
    await transaction.insert(packingScans).values({
      orderItemId: item.id,
      scannedBy: user.userId,
      quantity: parsed.data.quantity,
    });
    await transaction.insert(auditLogs).values({
      userId: user.userId,
      action: "packing_scan",
      entity: "sales_order",
      entityId: order.id,
      after: { sku: item.sku, barcode: parsed.data.barcode, quantity: parsed.data.quantity },
    });
  });
  revalidatePath(`/orders/${parsed.data.orderId}`);
  redirect(`/orders/${parsed.data.orderId}?scan=1`);
}

export async function requestPackingQcAction(formData: FormData) {
  const user = await requireRoles(["admin", "warehouse_manager", "warehouse_staff"]);
  const orderId = z.string().uuid().safeParse(formData.get("orderId"));
  if (!orderId.success) redirect("/orders");
  const warehouseId = await getUserWarehouse(user.userId);

  await db.transaction(async (transaction) => {
    const [order] = await transaction
      .select({ id: salesOrders.id, status: salesOrders.status })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, orderId.data), eq(salesOrders.warehouseId, warehouseId)))
      .for("update")
      .limit(1);
    if (!order || order.status !== "picking") throw new Error("Pesanan tidak sedang dipicking.");
    const items = await transaction
      .select({
        id: salesOrderItems.id,
        quantity: salesOrderItems.quantity,
        scanned: sql<string>`coalesce((
          SELECT sum(ps.quantity) FROM packing_scans ps
          WHERE ps.order_item_id = ${salesOrderItems.id}
        ), 0)`,
      })
      .from(salesOrderItems)
      .where(eq(salesOrderItems.orderId, order.id));
    if (!items.length || items.some((item) => milliUnits(item.scanned) !== milliUnits(item.quantity))) {
      throw new Error("Scan packing belum cocok dengan jumlah semua item pesanan.");
    }
    await transaction
      .update(salesOrders)
      .set({ status: "qc_pending", statusUpdatedAt: new Date(), updatedAt: new Date() })
      .where(eq(salesOrders.id, order.id));
  });
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId.data}`);
  redirect(`/orders/${orderId.data}?qc=pending`);
}

const packingQcSchema = z.object({
  orderId: z.string().uuid(),
  result: z.enum(["passed", "failed"]),
  packingType: z.enum(["plastic", "bubble_wrap", "cardboard", "other"]),
  notes: z.string().trim().max(500),
});

export async function completePackingQcAction(formData: FormData) {
  const user = await requireRoles(["admin", "warehouse_manager", "qc"]);
  const parsed = packingQcSchema.safeParse({
    orderId: formData.get("orderId"),
    result: formData.get("result"),
    packingType: formData.get("packingType"),
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success || (parsed.data.result === "failed" && !parsed.data.notes)) {
    redirect(`/orders/${String(formData.get("orderId"))}?error=qc`);
  }
  const warehouseId = await getUserWarehouse(user.userId);

  try {
    await db.transaction(async (transaction) => {
    const [order] = await transaction
      .select({ id: salesOrders.id, status: salesOrders.status, trackingNumber: salesOrders.trackingNumber })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, parsed.data.orderId), eq(salesOrders.warehouseId, warehouseId)))
      .for("update")
      .limit(1);
      if (!order || order.status !== "qc_pending") throw new Error("Pesanan tidak menunggu QC packing.");

    await transaction.insert(packingInspections).values({
      orderId: order.id,
      result: parsed.data.result,
      packingType: parsed.data.packingType,
      notes: parsed.data.notes || null,
      inspectedBy: user.userId,
    });

    if (parsed.data.result === "failed") {
      await transaction.delete(packingScans).where(
        inArray(
          packingScans.orderItemId,
          transaction
            .select({ id: salesOrderItems.id })
            .from(salesOrderItems)
            .where(eq(salesOrderItems.orderId, order.id)),
        ),
      );
      await transaction
        .update(salesOrders)
        .set({ status: "picking", statusUpdatedAt: new Date(), updatedAt: new Date() })
        .where(eq(salesOrders.id, order.id));
    } else {
      const items = await transaction
        .select({
          id: salesOrderItems.id,
          variantId: salesOrderItems.variantId,
          quantity: salesOrderItems.quantity,
        })
        .from(salesOrderItems)
        .where(eq(salesOrderItems.orderId, order.id));
      for (const item of items) {
        const reservations = await transaction
          .select({
            id: stockReservations.id,
            locationId: stockReservations.locationId,
            quantity: stockReservations.quantity,
          })
          .from(stockReservations)
          .where(and(eq(stockReservations.orderItemId, item.id), isNull(stockReservations.releasedAt)))
          .orderBy(asc(stockReservations.locationId))
          .for("update");
        const reserved = reservations.reduce((sum, reservation) => sum + milliUnits(reservation.quantity), 0);
        if (reserved !== milliUnits(item.quantity)) throw new Error("Reservasi stok pesanan tidak lengkap.");
        for (const reservation of reservations) {
          await recordStockMovement(
            {
              warehouseId,
              variantId: item.variantId,
              type: "ship",
              quantity: reservation.quantity,
              fromLocationId: reservation.locationId,
              referenceType: "sales_order",
              referenceId: order.id,
              reason: `QC packing lolos · ${order.trackingNumber}`,
              createdBy: user.userId,
            },
            transaction,
          );
          await transaction
            .update(stockReservations)
            .set({ releasedAt: new Date(), updatedAt: new Date() })
            .where(eq(stockReservations.id, reservation.id));
        }
      }
      await transaction
        .update(salesOrders)
        .set({
          status: "ready_to_ship",
          packingType: parsed.data.packingType,
          statusUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(salesOrders.id, order.id));
    }
      await transaction.insert(auditLogs).values({
        userId: user.userId,
        action: `packing_qc_${parsed.data.result}`,
        entity: "sales_order",
        entityId: order.id,
        after: { packingType: parsed.data.packingType, notes: parsed.data.notes || null },
      });
    });
  } catch (error) {
    if (error instanceof StockCountLockError) {
      redirect(`/orders/${parsed.data.orderId}?error=count_active`);
    }
    throw error;
  }
  revalidatePath("/");
  revalidatePath("/orders");
  revalidatePath(`/orders/${parsed.data.orderId}`);
  revalidatePath("/inventory");
  redirect(`/orders/${parsed.data.orderId}?qc=${parsed.data.result}`);
}

export async function handoverOrderAction(formData: FormData) {
  const user = await requireRoles(["admin", "warehouse_manager", "warehouse_staff"]);
  const orderId = z.string().uuid().safeParse(formData.get("orderId"));
  const scannedTracking = z.string().trim().min(3).max(120).safeParse(formData.get("trackingNumber"));
  if (!orderId.success || !scannedTracking.success) redirect("/orders");
  const warehouseId = await getUserWarehouse(user.userId);
  const updated = await db.transaction(async (transaction) => {
    const now = new Date();
    const [order] = await transaction
      .update(salesOrders)
      .set({
        status: "handed_over",
        handedOverAt: now,
        statusUpdatedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(salesOrders.id, orderId.data),
          eq(salesOrders.warehouseId, warehouseId),
          eq(salesOrders.status, "ready_to_ship"),
          eq(salesOrders.trackingNumber, scannedTracking.data.toUpperCase()),
        ),
      )
      .returning({ id: salesOrders.id });
    if (order) {
      await transaction.insert(auditLogs).values({
        userId: user.userId,
        action: "courier_handover",
        entity: "sales_order",
        entityId: order.id,
        after: { trackingNumber: scannedTracking.data.toUpperCase() },
      });
    }
    return order;
  });
  if (!updated) redirect(`/orders/${orderId.data}?error=handover`);
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId.data}`);
  redirect(`/orders/${orderId.data}?handover=1`);
}

const outcomeSchema = z.object({
  orderId: z.string().uuid(),
  outcome: z.enum(["success", "failed", "returned", "cancelled"]),
});

export async function updateDeliveryOutcomeAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "reseller" && !["admin", "online_ops"].includes(user.role)) {
    redirect("/?error=forbidden");
  }
  const parsed = outcomeSchema.safeParse({
    orderId: formData.get("orderId"),
    outcome: formData.get("outcome"),
  });
  if (!parsed.success) redirect("/portal?error=invalid");

  const now = new Date();
  const updatedOrder = await db.transaction(async (transaction) => {
    const [order] = await transaction
      .select({
        id: salesOrders.id,
        resellerId: salesOrders.resellerId,
        status: salesOrders.status,
        handedOverAt: salesOrders.handedOverAt,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, parsed.data.orderId))
      .for("update")
      .limit(1);
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (
      !order ||
      (user.role === "reseller" && order.resellerId !== user.userId) ||
      order.status !== "handed_over" ||
      !order.handedOverAt ||
      order.handedOverAt < cutoff
    ) {
      return null;
    }

    const [updated] = await transaction
      .update(salesOrders)
      .set({
        deliveryOutcome: parsed.data.outcome,
        outcomeUpdatedAt: now,
        status:
          parsed.data.outcome === "success"
            ? "delivered"
            : parsed.data.outcome === "returned"
              ? "returned"
              : parsed.data.outcome === "cancelled"
                ? "cancelled"
                : "failed",
        statusUpdatedAt: now,
        updatedAt: now,
      })
      .where(and(eq(salesOrders.id, order.id), eq(salesOrders.status, "handed_over")))
      .returning({ id: salesOrders.id });
    if (!updated) return null;
    await transaction.insert(auditLogs).values({
      userId: user.userId,
      action: "delivery_outcome_updated",
      entity: "sales_order",
      entityId: updated.id,
      before: { status: order.status },
      after: { deliveryOutcome: parsed.data.outcome },
    });
    return updated;
  });
  if (!updatedOrder) {
    redirect(user.role === "reseller" ? "/portal?error=locked" : `/orders/${parsed.data.orderId}?error=locked`);
  }

  revalidatePath("/portal");
  revalidatePath("/orders");
  revalidatePath(`/orders/${updatedOrder.id}`);
  revalidatePath("/billing");
  redirect(user.role === "reseller" ? "/portal?updated=1" : `/orders/${updatedOrder.id}?updated=1`);
}
