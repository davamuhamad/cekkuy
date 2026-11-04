"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { locations } from "@/db/schema";
import { recordStockMovement, StockCountLockError } from "@/db/stock";
import { getUserWarehouse, requireRoles } from "@/lib/auth";

const adjustmentSchema = z.object({
  variantId: z.string().uuid(),
  direction: z.enum(["in", "out"]),
  quantity: z.string().regex(/^\d{1,11}(?:\.\d{1,3})?$/),
  reason: z.string().trim().min(5).max(500),
});

export async function adjustStockAction(formData: FormData) {
  const user = await requireRoles(["admin", "warehouse_manager"]);
  const parsed = adjustmentSchema.safeParse({
    variantId: formData.get("variantId"),
    direction: formData.get("direction"),
    quantity: formData.get("quantity"),
    reason: formData.get("reason"),
  });
  if (!parsed.success || Number(parsed.data?.quantity ?? 0) <= 0) {
    redirect("/inventory?error=invalid");
  }

  const warehouseId = await getUserWarehouse(user.userId);
  const [storage] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.warehouseId, warehouseId), eq(locations.type, "storage")))
    .limit(1);
  if (!storage) redirect("/inventory?error=location");

  try {
    await recordStockMovement({
      warehouseId,
      variantId: parsed.data.variantId,
      type: "adjust",
      quantity: parsed.data.quantity,
      ...(parsed.data.direction === "in"
        ? { toLocationId: storage.id }
        : { fromLocationId: storage.id }),
      reason: parsed.data.reason,
      createdBy: user.userId,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Stok di lokasi asal tidak mencukupi.") {
      redirect("/inventory?error=insufficient");
    }
    if (error instanceof StockCountLockError) {
      redirect("/inventory?error=count_active");
    }
    throw error;
  }

  revalidatePath("/");
  revalidatePath("/inventory");
  redirect("/inventory?updated=1");
}
