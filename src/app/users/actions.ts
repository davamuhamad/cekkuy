"use server";

import { hash } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, userWarehouses, users, warehouses } from "@/db/schema";
import { requireRoles } from "@/lib/auth";

const userInput = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(254).transform((email) => email.trim().toLowerCase()),
  password: z.string().min(12).max(72).refine((value) => Buffer.byteLength(value, "utf8") <= 72),
  role: z.enum(["reseller", "warehouse_staff", "qc", "purchasing", "online_ops", "warehouse_manager", "management"]),
});

export async function createUserAction(formData: FormData) {
  const admin = await requireRoles(["admin"]);
  const parsed = userInput.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success) redirect("/users?error=invalid");
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email)).limit(1);
  if (existing) redirect("/users?error=duplicate");

  await db.transaction(async (transaction) => {
    const [warehouse] = await transaction.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.code, "GUDANG-UTAMA")).limit(1);
    if (!warehouse) throw new Error("Gudang utama belum dibuat. Jalankan bootstrap terlebih dahulu.");
    const [created] = await transaction
      .insert(users)
      .values({
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash: await hash(parsed.data.password, 12),
        role: parsed.data.role,
      })
      .returning({ id: users.id });
    await transaction.insert(userWarehouses).values({
      userId: created.id,
      warehouseId: warehouse.id,
    });
    await transaction.insert(auditLogs).values({
      userId: admin.userId,
      action: "user_created",
      entity: "user",
      entityId: created.id,
      after: { email: parsed.data.email, role: parsed.data.role },
    });
  });
  revalidatePath("/users");
  redirect("/users?created=1");
}
