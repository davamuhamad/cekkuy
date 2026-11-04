"use server";

import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  auditLogs,
  goodsReceipts,
  locations,
  productVariants,
  purchaseOrderItems,
  purchaseOrders,
  qcInspections,
  receiptItems,
  suppliers,
} from "@/db/schema";
import { recordStockMovement, StockCountLockError } from "@/db/stock";
import { getUserWarehouse, requireRoles } from "@/lib/auth";

const receiptSchema = z.object({
  supplier: z.string().trim().max(160),
  purchaseOrderId: z.string().uuid().optional(),
  notes: z.string().trim().max(500),
  variantIds: z.array(z.string().uuid()).min(1).max(50),
  quantities: z.array(z.string().regex(/^\d{1,11}(?:\.\d{1,3})?$/)).min(1).max(50),
});

export async function createReceiptAction(formData: FormData) {
  const user = await requireRoles(["admin", "warehouse_manager", "warehouse_staff"]);
  const parsed = receiptSchema.safeParse({
    supplier: formData.get("supplier") ?? "",
    purchaseOrderId: formData.get("purchaseOrderId") || undefined,
    notes: formData.get("notes") ?? "",
    variantIds: formData.getAll("variantId"),
    quantities: formData.getAll("quantity"),
  });

  if (
    !parsed.success ||
    parsed.data.variantIds.length !== parsed.data.quantities.length ||
    parsed.data.quantities.some((quantity) => Number(quantity) <= 0) ||
    new Set(parsed.data.variantIds).size !== parsed.data.variantIds.length
  ) {
    redirect("/receiving/new?error=invalid");
  }

  const warehouseId = await getUserWarehouse(user.userId);
  const quarantineLocation = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.warehouseId, warehouseId), eq(locations.type, "quarantine")))
    .limit(1);
  if (!quarantineLocation.length) redirect("/receiving/new?error=location");

  const variantRecords = await db
    .select({ id: productVariants.id, sku: productVariants.sku })
    .from(productVariants)
    .where(
      and(
        inArray(productVariants.id, parsed.data.variantIds),
        eq(productVariants.isActive, true),
      ),
    );
  if (variantRecords.length !== parsed.data.variantIds.length) {
    redirect("/receiving/new?error=variants");
  }

  const receiptNumber = `GR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(3).toString("hex").toUpperCase()}`;

  try {
    await db.transaction(async (transaction) => {
    let supplierId: string | null = null;
    let purchaseOrderId: string | null = null;
    if (parsed.data.purchaseOrderId) {
      const [purchaseOrder] = await transaction
        .select({
          id: purchaseOrders.id,
          supplierId: purchaseOrders.supplierId,
          status: purchaseOrders.status,
        })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.id, parsed.data.purchaseOrderId),
            eq(purchaseOrders.warehouseId, warehouseId),
          ),
        )
        .for("update")
        .limit(1);
      if (!purchaseOrder || !["sent", "partial"].includes(purchaseOrder.status)) {
        throw new Error("PO tidak ditemukan atau sudah selesai.");
      }
      purchaseOrderId = purchaseOrder.id;
      supplierId = purchaseOrder.supplierId;
      const poItems = await transaction
        .select({
          id: purchaseOrderItems.id,
          variantId: purchaseOrderItems.variantId,
          quantity: purchaseOrderItems.quantity,
          receivedQuantity: purchaseOrderItems.receivedQuantity,
        })
        .from(purchaseOrderItems)
        .where(
          and(
            eq(purchaseOrderItems.purchaseOrderId, purchaseOrder.id),
            inArray(purchaseOrderItems.variantId, parsed.data.variantIds),
          ),
        )
        .for("update");
      if (poItems.length !== parsed.data.variantIds.length) {
        throw new Error("Varian penerimaan tidak tercantum di PO.");
      }
      for (let index = 0; index < parsed.data.variantIds.length; index += 1) {
        const poItem = poItems.find((item) => item.variantId === parsed.data.variantIds[index]);
        if (
          !poItem ||
          Number(poItem.receivedQuantity) + Number(parsed.data.quantities[index]) > Number(poItem.quantity)
        ) {
          throw new Error("Jumlah penerimaan melebihi sisa jumlah PO.");
        }
      }
    } else if (parsed.data.supplier) {
      await transaction
        .insert(suppliers)
        .values({ name: parsed.data.supplier })
        .onConflictDoNothing();
      const [supplier] = await transaction
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.name, parsed.data.supplier))
        .limit(1);
      if (!supplier) throw new Error("Pemasok gagal dibuat atau ditemukan.");
      supplierId = supplier.id;
    }

    const [receipt] = await transaction
      .insert(goodsReceipts)
      .values({
        warehouseId,
        supplierId,
        purchaseOrderId,
        receiptNumber,
        notes: parsed.data.notes || null,
        receivedBy: user.userId,
      })
      .returning({ id: goodsReceipts.id });

    const items = await transaction
      .insert(receiptItems)
      .values(
        parsed.data.variantIds.map((variantId, index) => ({
          receiptId: receipt.id,
          variantId,
          receivedQuantity: parsed.data.quantities[index],
        })),
      )
      .returning({
        id: receiptItems.id,
        variantId: receiptItems.variantId,
        receivedQuantity: receiptItems.receivedQuantity,
      });

    if (purchaseOrderId) {
      for (const item of items) {
        await transaction
          .update(purchaseOrderItems)
          .set({
            receivedQuantity: sql`${purchaseOrderItems.receivedQuantity} + ${item.receivedQuantity}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId),
              eq(purchaseOrderItems.variantId, item.variantId),
            ),
          );
      }
      const remainingLines = await transaction
        .select({
          quantity: purchaseOrderItems.quantity,
          receivedQuantity: purchaseOrderItems.receivedQuantity,
        })
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId));
      const isComplete = remainingLines.every(
        (line) => Number(line.receivedQuantity) >= Number(line.quantity),
      );
      await transaction
        .update(purchaseOrders)
        .set({ status: isComplete ? "completed" : "partial", updatedAt: new Date() })
        .where(eq(purchaseOrders.id, purchaseOrderId));
    }

    for (const item of items) {
      await recordStockMovement(
        {
          warehouseId,
          variantId: item.variantId,
          type: "receipt",
          quantity: item.receivedQuantity,
          toLocationId: quarantineLocation[0].id,
          referenceType: "goods_receipt",
          referenceId: receipt.id,
          reason: `Penerimaan ${receiptNumber}`,
          createdBy: user.userId,
        },
        transaction,
      );
    }

    await transaction.insert(auditLogs).values({
      userId: user.userId,
      action: "goods_receipt",
      entity: "goods_receipt",
      entityId: receipt.id,
      after: { receiptNumber, itemCount: items.length, status: "qc_pending" },
    });
    });
  } catch (error) {
    if (error instanceof StockCountLockError) {
      redirect("/receiving/new?error=count_active");
    }
    throw error;
  }

  revalidatePath("/");
  revalidatePath("/receiving");
  revalidatePath("/inventory");
  redirect("/receiving?created=1");
}

const qcSchema = z.object({
  receiptId: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).min(1).max(50),
  results: z.array(z.enum(["passed", "failed"])).min(1).max(50),
  notes: z.array(z.string().trim().max(500)),
});

export async function completeQcAction(formData: FormData) {
  const user = await requireRoles(["admin", "warehouse_manager", "qc"]);
  const parsed = qcSchema.safeParse({
    receiptId: formData.get("receiptId"),
    itemIds: formData.getAll("itemId"),
    results: formData.getAll("result"),
    notes: formData.getAll("qcNote"),
  });
  if (
    !parsed.success ||
    parsed.data.itemIds.length !== parsed.data.results.length ||
    parsed.data.itemIds.length !== parsed.data.notes.length ||
    new Set(parsed.data.itemIds).size !== parsed.data.itemIds.length
  ) {
    redirect(`/receiving/${String(formData.get("receiptId"))}?error=invalid`);
  }
  if (
    parsed.data.results.some(
      (result, index) => result === "failed" && !parsed.data.notes[index],
    )
  ) {
    redirect(`/receiving/${parsed.data.receiptId}?error=note`);
  }

  const warehouseId = await getUserWarehouse(user.userId);
  try {
    await db.transaction(async (transaction) => {
    const [receipt] = await transaction
      .select({
        id: goodsReceipts.id,
        receiptNumber: goodsReceipts.receiptNumber,
        status: goodsReceipts.status,
      })
      .from(goodsReceipts)
      .where(
        and(
          eq(goodsReceipts.id, parsed.data.receiptId),
          eq(goodsReceipts.warehouseId, warehouseId),
        ),
      )
      .for("update")
      .limit(1);

    if (!receipt || receipt.status !== "qc_pending") {
      throw new Error("Penerimaan tidak ditemukan atau QC sudah diselesaikan.");
    }

    const items = await transaction
      .select({
        id: receiptItems.id,
        variantId: receiptItems.variantId,
        receivedQuantity: receiptItems.receivedQuantity,
        qcStatus: receiptItems.qcStatus,
      })
      .from(receiptItems)
      .where(eq(receiptItems.receiptId, receipt.id))
      .for("update");

    const submittedItemIds = new Set(parsed.data.itemIds);
    if (
      items.length !== parsed.data.itemIds.length ||
      items.some((item) => !submittedItemIds.has(item.id) || item.qcStatus !== "pending")
    ) {
      throw new Error("Item penerimaan tidak valid atau sudah diperiksa.");
    }

    const storage = await transaction
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.warehouseId, warehouseId), eq(locations.type, "storage")))
      .limit(1);
    const reject = await transaction
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.warehouseId, warehouseId), eq(locations.type, "reject")))
      .limit(1);
    if (!storage.length || !reject.length) {
      throw new Error("Lokasi penyimpanan atau reject belum tersedia di gudang.");
    }
    const quarantine = await transaction
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.warehouseId, warehouseId), eq(locations.type, "quarantine")))
      .limit(1);
    if (!quarantine.length) {
      throw new Error("Lokasi karantina belum tersedia di gudang.");
    }

    const resultByItem = new Map(
      parsed.data.itemIds.map((itemId, index) => [
        itemId,
        { result: parsed.data.results[index], note: parsed.data.notes[index] },
      ]),
    );

    for (const item of items) {
      const inspection = resultByItem.get(item.id);
      if (!inspection) throw new Error("Hasil QC item tidak ditemukan.");
      if (inspection.result === "failed" && !inspection.note) {
        throw new Error("Catatan cacat wajib diisi untuk item yang gagal QC.");
      }

      await transaction.insert(qcInspections).values({
        receiptItemId: item.id,
        result: inspection.result,
        notes: inspection.note || null,
        inspectedBy: user.userId,
      });
      await transaction
        .update(receiptItems)
        .set({
          qcStatus: inspection.result === "passed" ? "passed" : "failed",
          updatedAt: new Date(),
        })
        .where(eq(receiptItems.id, item.id));

      await recordStockMovement(
        {
          warehouseId,
          variantId: item.variantId,
          type: inspection.result === "passed" ? "qc_release" : "qc_fail",
          quantity: item.receivedQuantity,
          fromLocationId: quarantine[0].id,
          toLocationId: inspection.result === "passed" ? storage[0].id : reject[0].id,
          referenceType: "goods_receipt",
          referenceId: receipt.id,
          reason: inspection.note || `QC ${inspection.result === "passed" ? "lulus" : "gagal"} ${receipt.receiptNumber}`,
          createdBy: user.userId,
        },
        transaction,
      );
    }

    await transaction
      .update(goodsReceipts)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(goodsReceipts.id, receipt.id));
    await transaction.insert(auditLogs).values({
      userId: user.userId,
      action: "qc_completed",
      entity: "goods_receipt",
      entityId: receipt.id,
      after: { receiptNumber: receipt.receiptNumber, itemCount: items.length },
    });
    });
  } catch (error) {
    if (error instanceof StockCountLockError) {
      redirect(`/receiving/${parsed.data.receiptId}?error=count_active`);
    }
    throw error;
  }

  revalidatePath("/");
  revalidatePath("/receiving");
  revalidatePath(`/receiving/${parsed.data.receiptId}`);
  revalidatePath("/inventory");
  redirect(`/receiving/${parsed.data.receiptId}?qc=complete`);
}
