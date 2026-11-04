"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, categories, productVariants, products } from "@/db/schema";
import { requireRoles } from "@/lib/auth";

const productSchema = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().max(80),
  description: z.string().trim().max(1000),
  skus: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  barcodes: z.array(z.string().trim().max(80)),
  variantNames: z.array(z.string().trim().min(1).max(120)),
  units: z.array(z.string().trim().min(1).max(20)),
  costs: z.array(z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/)),
  prices: z.array(z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/)),
  minimumStocks: z.array(z.string().regex(/^\d{1,7}$/)),
});

export async function createProductAction(formData: FormData) {
  const user = await requireRoles(["admin", "warehouse_manager", "purchasing"]);
  const parsed = productSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category") ?? "",
    description: formData.get("description") ?? "",
    skus: formData.getAll("sku"),
    barcodes: formData.getAll("barcode"),
    variantNames: formData.getAll("variantName"),
    units: formData.getAll("unit"),
    costs: formData.getAll("cost"),
    prices: formData.getAll("price"),
    minimumStocks: formData.getAll("minimumStock"),
  });

  if (!parsed.success) redirect("/products/new?error=invalid");
  const values = parsed.data;
  const variantCount = values.skus.length;
  if (
    [
      values.barcodes,
      values.variantNames,
      values.units,
      values.costs,
      values.prices,
      values.minimumStocks,
    ].some((items) => items.length !== variantCount) ||
    new Set(values.skus.map((sku) => sku.toUpperCase())).size !== variantCount
  ) {
    redirect("/products/new?error=variants");
  }

  const skuExists = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(inArray(productVariants.sku, values.skus.map((sku) => sku.toUpperCase())))
    .limit(1);
  if (
    skuExists.length ||
    new Set(values.barcodes.filter(Boolean)).size !== values.barcodes.filter(Boolean).length
  ) {
    redirect("/products/new?error=duplicate");
  }
  const barcodes = values.barcodes.filter(Boolean);
  if (barcodes.length) {
    const barcodeExists = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(inArray(productVariants.barcode, barcodes))
      .limit(1);
    if (barcodeExists.length) redirect("/products/new?error=duplicate");
  }

  await db.transaction(async (transaction) => {
    let categoryId: string | null = null;
    if (values.category) {
      await transaction
        .insert(categories)
        .values({ name: values.category })
        .onConflictDoNothing();
      const [category] = await transaction
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.name, values.category))
        .limit(1);
      if (!category) throw new Error("Kategori gagal dibuat atau ditemukan.");
      categoryId = category.id;
    }

    const [product] = await transaction
      .insert(products)
      .values({
        name: values.name,
        categoryId,
        description: values.description || null,
      })
      .returning({ id: products.id });

    await transaction.insert(productVariants).values(
      values.skus.map((sku, index) => ({
        productId: product.id,
        sku: sku.toUpperCase(),
        barcode: values.barcodes[index] || null,
        variantName: values.variantNames[index],
        unit: values.units[index],
        costPrice: values.costs[index],
        resellerPrice: values.prices[index],
        minimumStock: Number(values.minimumStocks[index]),
      })),
    );

    await transaction.insert(auditLogs).values({
      userId: user.userId,
      action: "create",
      entity: "product",
      entityId: product.id,
      after: { name: values.name, skus: values.skus.map((sku) => sku.toUpperCase()) },
    });
  });

  revalidatePath("/");
  revalidatePath("/products");
  revalidatePath("/inventory");
  redirect("/products?created=1");
}
