"use server";

import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  auditLogs,
  locations,
  productVariants,
  products,
  stockBalances,
  stockCountItems,
  stockCounts,
  salesOrderItems,
  salesOrders,
  stockReservations,
} from "@/db/schema";
import {
  formatStockCountQuantity,
  stockCountDifference,
  stockCountMilliUnits,
  stockCountQuantitySchema,
} from "@/db/stock-count";
import { recordStockMovement } from "@/db/stock";
import { getUserWarehouse, requireRoles } from "@/lib/auth";

const createSchema = z.object({ locationId: z.string().uuid() });
const lineSchema = z.object({
  stockCountId: z.string().uuid(),
  itemId: z.string().uuid(),
  quantity: stockCountQuantitySchema,
});
const countIdSchema = z.string().uuid();

const countRoles = ["admin", "warehouse_manager", "warehouse_staff"] as const;
const approveRoles = ["admin", "warehouse_manager"] as const;

function isValidQuantity(quantity: string) {
  return Number.isSafeInteger(stockCountMilliUnits(quantity));
}

function countUrl(id: string, query: string) {
  return `/stock-counts/${id}?${query}`;
}

export async function createStockCountAction(formData: FormData) {
  const user = await requireRoles(countRoles);
  const parsed = createSchema.safeParse({
    locationId: formData.get("locationId"),
  });
  if (!parsed.success) redirect("/stock-counts/new?error=invalid");
  const warehouseId = await getUserWarehouse(user.userId);

  const result = await db.transaction(async (transaction) => {
    const [location] = await transaction
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.id, parsed.data.locationId),
          eq(locations.warehouseId, warehouseId),
        ),
      )
      .for("update")
      .limit(1);
    if (!location) return { error: "location" as const };

    const [active] = await transaction
      .select({ id: stockCounts.id })
      .from(stockCounts)
      .where(
        and(
          eq(stockCounts.locationId, location.id),
          inArray(stockCounts.status, ["counting", "review"]),
        ),
      )
      .limit(1);
    if (active) return { error: "active" as const };

    const [activePick] = await transaction
      .select({ id: salesOrders.id })
      .from(stockReservations)
      .innerJoin(
        salesOrderItems,
        eq(stockReservations.orderItemId, salesOrderItems.id),
      )
      .innerJoin(salesOrders, eq(salesOrderItems.orderId, salesOrders.id))
      .where(
        and(
          eq(stockReservations.warehouseId, warehouseId),
          eq(stockReservations.locationId, location.id),
          sql`${stockReservations.releasedAt} IS NULL`,
          inArray(salesOrders.status, ["picking", "packing", "qc_pending"]),
        ),
      )
      .limit(1);
    if (activePick) return { error: "picking" as const };

    const variants = await transaction
      .select({
        variantId: productVariants.id,
        quantity: sql<string>`coalesce(${stockBalances.quantity}, 0)`,
      })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .leftJoin(
        stockBalances,
        and(
          eq(stockBalances.variantId, productVariants.id),
          eq(stockBalances.warehouseId, warehouseId),
          eq(stockBalances.locationId, location.id),
        ),
      )
      .where(
        or(
          and(
            eq(productVariants.isActive, true),
            eq(products.isActive, true),
          ),
          sql`coalesce(${stockBalances.quantity}, 0) > 0`,
        ),
      )
      .orderBy(asc(productVariants.id));
    if (!variants.length) return { error: "empty" as const };

    const [count] = await transaction
      .insert(stockCounts)
      .values({
        warehouseId,
        locationId: location.id,
        createdBy: user.userId,
      })
      .returning({ id: stockCounts.id });

    await transaction.insert(stockCountItems).values(
      variants.map((variant) => ({
        stockCountId: count.id,
        variantId: variant.variantId,
        expectedQuantity: variant.quantity,
      })),
    );
    await transaction.insert(auditLogs).values({
      userId: user.userId,
      action: "stock_count_started",
      entity: "stock_count",
      entityId: count.id,
      after: { locationId: location.id, variantCount: variants.length },
    });
    return { id: count.id };
  });

  if ("error" in result) redirect(`/stock-counts/new?error=${result.error}`);
  revalidatePath("/stock-counts");
  redirect(`/stock-counts/${result.id}`);
}

export async function recordStockCountItemAction(formData: FormData) {
  const user = await requireRoles(countRoles);
  const parsed = lineSchema.safeParse({
    stockCountId: formData.get("stockCountId"),
    itemId: formData.get("itemId"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success || !isValidQuantity(parsed.data.quantity)) {
    redirect("/stock-counts?error=invalid");
  }
  const warehouseId = await getUserWarehouse(user.userId);
  const result = await db.transaction(async (transaction) => {
    const [count] = await transaction
      .select({ id: stockCounts.id, status: stockCounts.status })
      .from(stockCounts)
      .where(
        and(
          eq(stockCounts.id, parsed.data.stockCountId),
          eq(stockCounts.warehouseId, warehouseId),
        ),
      )
      .for("update")
      .limit(1);
    if (!count || count.status !== "counting") return "locked" as const;

    const [item] = await transaction
      .update(stockCountItems)
      .set({
        countedQuantity: parsed.data.quantity,
        countedBy: user.userId,
        countedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stockCountItems.id, parsed.data.itemId),
          eq(stockCountItems.stockCountId, count.id),
        ),
      )
      .returning({ id: stockCountItems.id, variantId: stockCountItems.variantId });
    if (!item) return "item" as const;
    await transaction.insert(auditLogs).values({
      userId: user.userId,
      action: "stock_count_item_recorded",
      entity: "stock_count",
      entityId: count.id,
      after: {
        itemId: item.id,
        variantId: item.variantId,
        quantity: parsed.data.quantity,
      },
    });
    return "saved" as const;
  });

  revalidatePath("/stock-counts");
  revalidatePath(`/stock-counts/${parsed.data.stockCountId}`);
  redirect(countUrl(parsed.data.stockCountId, result === "saved" ? "saved=1" : `error=${result}`));
}

export async function submitStockCountAction(formData: FormData) {
  const user = await requireRoles(countRoles);
  const parsed = countIdSchema.safeParse(formData.get("stockCountId"));
  if (!parsed.success) redirect("/stock-counts");
  const warehouseId = await getUserWarehouse(user.userId);

  const submitted = await db.transaction(async (transaction) => {
    const [count] = await transaction
      .select({ id: stockCounts.id, status: stockCounts.status })
      .from(stockCounts)
      .where(
        and(
          eq(stockCounts.id, parsed.data),
          eq(stockCounts.warehouseId, warehouseId),
        ),
      )
      .for("update")
      .limit(1);
    if (!count || count.status !== "counting") return "locked" as const;

    const [incomplete] = await transaction
      .select({ id: stockCountItems.id })
      .from(stockCountItems)
      .where(
        and(
          eq(stockCountItems.stockCountId, count.id),
          sql`${stockCountItems.countedQuantity} IS NULL`,
        ),
      )
      .limit(1);
    if (incomplete) return "incomplete" as const;

    const now = new Date();
    await transaction
      .update(stockCounts)
      .set({ status: "review", submittedAt: now, updatedAt: now })
      .where(eq(stockCounts.id, count.id));
    await transaction.insert(auditLogs).values({
      userId: user.userId,
      action: "stock_count_submitted",
      entity: "stock_count",
      entityId: count.id,
      after: { status: "review" },
    });
    return "submitted" as const;
  });

  revalidatePath("/stock-counts");
  revalidatePath(`/stock-counts/${parsed.data}`);
  redirect(
    countUrl(
      parsed.data,
      submitted === "submitted" ? "submitted=1" : `error=${submitted}`,
    ),
  );
}

export async function approveStockCountAction(formData: FormData) {
  const user = await requireRoles(approveRoles);
  const parsed = countIdSchema.safeParse(formData.get("stockCountId"));
  if (!parsed.success) redirect("/stock-counts");
  const warehouseId = await getUserWarehouse(user.userId);

  try {
    const result = await db.transaction(async (transaction) => {
      const [count] = await transaction
        .select({
          id: stockCounts.id,
          status: stockCounts.status,
          locationId: stockCounts.locationId,
        })
        .from(stockCounts)
        .where(
          and(
            eq(stockCounts.id, parsed.data),
            eq(stockCounts.warehouseId, warehouseId),
          ),
        )
        .for("update")
        .limit(1);
      if (!count || count.status !== "review") return "locked" as const;

      const items = await transaction
        .select({
          itemId: stockCountItems.id,
          variantId: stockCountItems.variantId,
          expected: stockCountItems.expectedQuantity,
          counted: stockCountItems.countedQuantity,
          sku: productVariants.sku,
        })
        .from(stockCountItems)
        .innerJoin(
          productVariants,
          eq(stockCountItems.variantId, productVariants.id),
        )
        .where(eq(stockCountItems.stockCountId, count.id))
        .orderBy(asc(stockCountItems.variantId))
        .for("update");
      if (!items.length || items.some((item) => item.counted === null)) {
        return "incomplete" as const;
      }

      const now = new Date();
      await transaction
        .update(stockCounts)
        .set({
          status: "completed",
          approvedBy: user.userId,
          approvedAt: now,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(stockCounts.id, count.id));

      let changedLines = 0;
      for (const item of items) {
        const difference = stockCountDifference(item.expected, item.counted!);
        if (difference === 0) continue;
        changedLines += 1;
        await recordStockMovement(
          {
            warehouseId,
            variantId: item.variantId,
            type: "adjust",
            quantity: formatStockCountQuantity(Math.abs(difference)),
            ...(difference > 0
              ? { toLocationId: count.locationId }
              : { fromLocationId: count.locationId }),
            referenceType: "stock_count",
            referenceId: count.id,
            reason: `Hasil stock opname · ${item.sku}`,
            createdBy: user.userId,
          },
          transaction,
        );
      }
      await transaction.insert(auditLogs).values({
        userId: user.userId,
        action: "stock_count_approved",
        entity: "stock_count",
        entityId: count.id,
        after: { status: "completed", changedLines, itemCount: items.length },
      });
      return "completed" as const;
    });
    if (result !== "completed") {
      redirect(countUrl(parsed.data, `error=${result}`));
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "Penyesuaian tidak boleh mengurangi stok yang sudah direservasi."
    ) {
      redirect(countUrl(parsed.data, "error=reserved"));
    }
    throw error;
  }

  revalidatePath("/");
  revalidatePath("/inventory");
  revalidatePath("/stock-counts");
  revalidatePath(`/stock-counts/${parsed.data}`);
  redirect(countUrl(parsed.data, "approved=1"));
}

export async function cancelStockCountAction(formData: FormData) {
  const user = await requireRoles(countRoles);
  const parsed = countIdSchema.safeParse(formData.get("stockCountId"));
  if (!parsed.success) redirect("/stock-counts");
  const warehouseId = await getUserWarehouse(user.userId);

  const cancelled = await db.transaction(async (transaction) => {
    const [count] = await transaction
      .select({
        id: stockCounts.id,
        status: stockCounts.status,
        createdBy: stockCounts.createdBy,
      })
      .from(stockCounts)
      .where(
        and(
          eq(stockCounts.id, parsed.data),
          eq(stockCounts.warehouseId, warehouseId),
        ),
      )
      .for("update")
      .limit(1);
    if (
      !count ||
      !["counting", "review"].includes(count.status) ||
      (user.role === "warehouse_staff" && count.createdBy !== user.userId)
    ) {
      return false;
    }
    const now = new Date();
    await transaction
      .update(stockCounts)
      .set({ status: "cancelled", completedAt: now, updatedAt: now })
      .where(eq(stockCounts.id, count.id));
    await transaction.insert(auditLogs).values({
      userId: user.userId,
      action: "stock_count_cancelled",
      entity: "stock_count",
      entityId: count.id,
      before: { status: count.status },
      after: { status: "cancelled" },
    });
    return true;
  });

  if (!cancelled) redirect(countUrl(parsed.data, "error=locked"));
  revalidatePath("/stock-counts");
  revalidatePath(`/stock-counts/${parsed.data}`);
  redirect("/stock-counts?cancelled=1");
}
