"use server";

import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, productVariants, purchaseOrderItems, purchaseOrders, suppliers } from "@/db/schema";
import { getUserWarehouse, requireRoles } from "@/lib/auth";

const poSchema = z.object({
  supplier: z.string().trim().min(2).max(160),
  notes: z.string().trim().max(500),
  variantIds: z.array(z.string().uuid()).min(1).max(50),
  quantities: z.array(z.string().regex(/^\d{1,11}(?:\.\d{1,3})?$/)).min(1).max(50),
  costs: z.array(z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/)).min(1).max(50),
});

export async function createPurchaseOrderAction(formData: FormData) {
  const user = await requireRoles(["admin", "warehouse_manager", "purchasing"]);
  const parsed = poSchema.safeParse({
    supplier: formData.get("supplier"),
    notes: formData.get("notes") ?? "",
    variantIds: formData.getAll("variantId"),
    quantities: formData.getAll("quantity"),
    costs: formData.getAll("cost"),
  });
  if (
    !parsed.success ||
    parsed.data.variantIds.length !== parsed.data.quantities.length ||
    parsed.data.variantIds.length !== parsed.data.costs.length ||
    parsed.data.quantities.some((quantity) => Number(quantity) <= 0) ||
    new Set(parsed.data.variantIds).size !== parsed.data.variantIds.length
  ) {
    redirect("/purchasing/new?error=invalid");
  }
  const variants = await db.select({ id: productVariants.id }).from(productVariants)
    .where(and(inArray(productVariants.id, parsed.data.variantIds), eq(productVariants.isActive, true)));
  if (variants.length !== parsed.data.variantIds.length) redirect("/purchasing/new?error=variants");
  const warehouseId = await getUserWarehouse(user.userId);
  const poNumber = `PO-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(3).toString("hex").toUpperCase()}`;

  await db.transaction(async (transaction) => {
    await transaction.insert(suppliers).values({ name: parsed.data.supplier }).onConflictDoNothing();
    const [supplier] = await transaction.select({ id: suppliers.id }).from(suppliers)
      .where(eq(suppliers.name, parsed.data.supplier)).limit(1);
    if (!supplier) throw new Error("Pemasok gagal dibuat atau ditemukan.");
    const [po] = await transaction.insert(purchaseOrders).values({
      warehouseId,
      supplierId: supplier.id,
      poNumber,
      status: "sent",
      notes: parsed.data.notes || null,
      createdBy: user.userId,
    }).returning({ id: purchaseOrders.id });
    await transaction.insert(purchaseOrderItems).values(parsed.data.variantIds.map((variantId, index) => ({
      purchaseOrderId: po.id,
      variantId,
      quantity: parsed.data.quantities[index],
      unitCost: parsed.data.costs[index],
    })));
    await transaction.insert(auditLogs).values({
      userId: user.userId,
      action: "purchase_order_created",
      entity: "purchase_order",
      entityId: po.id,
      after: { poNumber, supplier: parsed.data.supplier, itemCount: parsed.data.variantIds.length },
    });
  });
  revalidatePath("/purchasing");
  revalidatePath("/receiving/new");
  redirect("/purchasing?created=1");
}
