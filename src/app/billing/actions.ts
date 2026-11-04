"use server";

import { randomBytes } from "node:crypto";
import { and, eq, gte, inArray,
lt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  auditLogs,
  codPayments,
  invoiceItems,
  invoices,
  resellerPayments,
  salesOrderItems,
  salesOrders,
  productVariants,
  users,
} from "@/db/schema";
import { getUserWarehouse, requireRoles, requireUser } from "@/lib/auth";

const invoiceInput = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

function milli(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}

function cents(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

function money(value: bigint) {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

function lineCents(quantity: string, unitPrice: string) {
  const weighted = milli(quantity) * cents(unitPrice);
  return (weighted + 500n) / 1000n;
}

export async function generateInvoicesAction(formData: FormData) {
  const user = await requireRoles(["admin", "online_ops"]);
  const parsed = invoiceInput.safeParse({ month: formData.get("month") });
  if (!parsed.success) redirect("/billing?error=month");
  const [yearText, monthText] = parsed.data.month.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (month < 1 || month > 12) redirect("/billing?error=month");
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const periodStart = `${yearText}-${monthText}-01`;
  const periodEndDate = new Date(Date.UTC(year, month, 0));
  const periodEnd = periodEndDate.toISOString().slice(0, 10);
  const dueAt = new Date(Date.now() + 7 * 86400000);
  const candidates = await db
    .select({
      id: salesOrders.id,
      resellerId: salesOrders.resellerId,
    })
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.deliveryOutcome, "success"),
        gte(salesOrders.outcomeUpdatedAt, start),
        lt(salesOrders.outcomeUpdatedAt, end),
      ),
    );
  if (!candidates.length) redirect("/billing?generated=0");

  const groups = new Map<string, string[]>();
  const alreadyBilled = new Set(
    (await db.select({ orderId: invoiceItems.orderId }).from(invoiceItems)).map((item) => item.orderId),
  );
  for (const candidate of candidates) {
    if (alreadyBilled.has(candidate.id)) continue;
    groups.set(candidate.resellerId, [...(groups.get(candidate.resellerId) ?? []), candidate.id]);
  }
  if (!groups.size) redirect("/billing?generated=0");

  await db.transaction(async (transaction) => {
    for (const [resellerId, orderIds] of groups) {
      const orders = await transaction
        .select({
          id: salesOrders.id,
          trackingNumber: salesOrders.trackingNumber,
        })
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.resellerId, resellerId),
            eq(salesOrders.deliveryOutcome, "success"),
            gte(salesOrders.outcomeUpdatedAt, start),
            lt(salesOrders.outcomeUpdatedAt, end),
            inArray(salesOrders.id, orderIds),
          ),
        )
        .for("update");
      if (!orders.length) continue;

      const lines = await transaction
        .select({
          orderId: salesOrderItems.orderId,
          quantity: salesOrderItems.quantity,
          unitPrice: salesOrderItems.unitPrice,
          sku: productVariants.sku,
        })
        .from(salesOrderItems)
        .innerJoin(productVariants, eq(salesOrderItems.variantId, productVariants.id))
        .where(inArray(salesOrderItems.orderId, orders.map((order) => order.id)));

      const orderTracking = new Map(orders.map((order) => [order.id, order.trackingNumber]));
      let total = 0n;
      const orderAmounts = new Map<string, bigint>();
      for (const line of lines) {
        const amount = lineCents(line.quantity, line.unitPrice);
        total += amount;
        orderAmounts.set(line.orderId, (orderAmounts.get(line.orderId) ?? 0n) + amount);
      }

      const number = `INV-${parsed.data.month.replace("-", "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
      const [invoice] = await transaction
        .insert(invoices)
        .values({
          resellerId,
          invoiceNumber: number,
          periodStart,
          periodEnd,
          status: "issued",
          subtotal: money(total),
          issuedAt: new Date(),
          dueAt,
          createdBy: user.userId,
        })
        .returning({ id: invoices.id });

      const invoiceRows = lines.map((line) => ({
        invoiceId: invoice.id,
        orderId: line.orderId,
        description: `${orderTracking.get(line.orderId)} · ${line.sku}`,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: money(lineCents(line.quantity, line.unitPrice)),
      }));
      if (invoiceRows.length) await transaction.insert(invoiceItems).values(invoiceRows);
      await transaction.insert(auditLogs).values({
        userId: user.userId,
        action: "invoice_issued",
        entity: "invoice",
        entityId: invoice.id,
        after: { invoiceNumber: number, subtotal: money(total), orders: orders.length },
      });
    }
  });
  revalidatePath("/billing");
  revalidatePath("/portal");
  redirect("/billing?generated=1");
}

const paymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/),
  method: z.string().trim().min(2).max(40),
  reference: z.string().trim().max(200),
});

export async function recordInvoicePaymentAction(formData: FormData) {
  const user = await requireUser();
  const parsed = paymentSchema.safeParse({
    invoiceId: formData.get("invoiceId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference") ?? "",
  });
  if (!parsed.success || Number(parsed.data.amount) <= 0) redirect("/portal?error=payment");

  await db.transaction(async (transaction) => {
    const [invoice] = await transaction
      .select({
        id: invoices.id,
        resellerId: invoices.resellerId,
        subtotal: invoices.subtotal,
        status: invoices.status,
      })
      .from(invoices)
      .where(eq(invoices.id, parsed.data.invoiceId))
      .for("update")
      .limit(1);
    if (
      !invoice ||
      (user.role === "reseller" && invoice.resellerId !== user.userId) ||
      (user.role !== "reseller" && !["admin", "online_ops"].includes(user.role)) ||
      !["issued", "partially_paid", "overdue"].includes(invoice.status)
    ) {
      throw new Error("Tagihan tidak ditemukan atau tidak dapat dibayar oleh akun ini.");
    }

    const [paid] = await transaction
      .select({ amount: sql<string>`coalesce(sum(${resellerPayments.amount}), 0)` })
      .from(resellerPayments)
      .where(eq(resellerPayments.invoiceId, invoice.id));
    const balance = cents(invoice.subtotal) - cents(paid.amount);
    if (cents(parsed.data.amount) > balance) throw new Error("Pembayaran melebihi sisa tagihan.");

    await transaction.insert(resellerPayments).values({
      resellerId: invoice.resellerId,
      invoiceId: invoice.id,
      amount: parsed.data.amount,
      method: parsed.data.method,
      reference: parsed.data.reference || null,
      recordedBy: user.userId,
    });
    const newPaid = cents(paid.amount) + cents(parsed.data.amount);
    const status = newPaid === cents(invoice.subtotal) ? "paid" : "partially_paid";
    await transaction.update(invoices).set({ status, updatedAt: new Date() }).where(eq(invoices.id, invoice.id));
    await transaction.insert(auditLogs).values({
      userId: user.userId,
      action: "invoice_payment_recorded",
      entity: "invoice",
      entityId: invoice.id,
      after: { amount: parsed.data.amount, method: parsed.data.method, reference: parsed.data.reference || null },
    });
  });
  revalidatePath("/billing");
  revalidatePath("/portal");
  redirect(user.role === "reseller" ? "/portal?payment=1" : "/billing?payment=1");
}

const codSchema = z.object({
  codId: z.string().uuid(),
  receivedAmount: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/).optional(),
  status: z.enum(["paid", "discrepancy", "no_collection"]),
  notes: z.string().trim().max(500),
});

export async function updateCodStatusAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "reseller" && !["admin", "warehouse_manager", "online_ops"].includes(user.role)) {
    redirect("/?error=forbidden");
  }
  const parsed = codSchema.safeParse({
    codId: formData.get("codId"),
    receivedAmount: formData.get("receivedAmount") || undefined,
    status: formData.get("status"),
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) redirect("/billing?error=cod");
  if (parsed.data.status !== "no_collection" && !parsed.data.receivedAmount) redirect(user.role === "reseller" ? "/portal?error=cod" : "/billing?error=cod");
  const updated = await db.transaction(async (transaction) => {
    const [cod] = await transaction
      .select({
        id: codPayments.id,
        expectedAmount: codPayments.expectedAmount,
        orderId: codPayments.orderId,
        resellerId: salesOrders.resellerId,
        handedOverAt: salesOrders.handedOverAt,
        status: codPayments.status,
      })
      .from(codPayments)
      .innerJoin(salesOrders, eq(codPayments.orderId, salesOrders.id))
      .where(eq(codPayments.id, parsed.data.codId))
      .for("update")
      .limit(1);
    if (
      !cod ||
      cod.status !== "pending" ||
      (user.role === "reseller" && cod.resellerId !== user.userId) ||
      (user.role !== "reseller" && !["admin", "warehouse_manager", "online_ops"].includes(user.role)) ||
      !cod.handedOverAt ||
      Date.now() > cod.handedOverAt.getTime() + 7 * 86400000 ||
      (parsed.data.status === "paid" &&
        cents(parsed.data.receivedAmount!) !== cents(cod.expectedAmount)) ||
      (parsed.data.status === "discrepancy" &&
        cents(parsed.data.receivedAmount!) === cents(cod.expectedAmount))
    ) {
      return null;
    }
    const [changed] = await transaction
      .update(codPayments)
      .set({
        status: parsed.data.status,
        receivedAmount: parsed.data.status === "no_collection" ? null : parsed.data.receivedAmount,
        receivedAt: parsed.data.status === "no_collection" ? null : new Date(),
        notes: parsed.data.notes || null,
        updatedBy: user.userId,
        updatedAt: new Date(),
      })
      .where(and(eq(codPayments.id, cod.id), eq(codPayments.status, "pending")))
      .returning({ id: codPayments.id });
    if (!changed) return null;
    await transaction.insert(auditLogs).values({
      userId: user.userId,
      action: "cod_status_updated",
      entity: "cod_payment",
      entityId: cod.id,
      before: { status: "pending" },
      after: { status: parsed.data.status, receivedAmount: parsed.data.receivedAmount ?? null, expectedAmount: cod.expectedAmount, orderId: cod.orderId },
    });
    return changed;
  });
  if (!updated) redirect(user.role === "reseller" ? "/portal?error=cod" : "/billing?error=cod");
  revalidatePath("/billing");
  revalidatePath("/portal");
  redirect(user.role === "reseller" ? "/portal?cod=1" : "/billing?cod=1");
}
