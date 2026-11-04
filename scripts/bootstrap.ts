import "dotenv/config";
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const adminName = process.env.ADMIN_NAME?.trim();
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!databaseUrl || !adminName || !adminEmail || !adminPassword) {
    throw new Error(
      "Set DATABASE_URL, ADMIN_NAME, ADMIN_EMAIL, dan ADMIN_PASSWORD sebelum bootstrap.",
    );
  }

  if (
    adminPassword.length < 12 ||
    Buffer.byteLength(adminPassword, "utf8") > 72
  ) {
    throw new Error("ADMIN_PASSWORD harus memiliki 12 hingga 72 byte UTF-8.");
  }

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    await db.transaction(async (transaction) => {
      const existing = await transaction.query.users.findFirst({
        where: eq(schema.users.email, adminEmail),
      });

      if (existing) {
        throw new Error(
          "Email admin sudah terdaftar; bootstrap tidak mengubah akun yang ada.",
        );
      }

      const [user] = await transaction
        .insert(schema.users)
        .values({
          name: adminName,
          email: adminEmail,
          passwordHash: await hash(adminPassword, 12),
          role: "admin",
        })
        .returning({ id: schema.users.id });

      const [warehouse] = await transaction
        .insert(schema.warehouses)
        .values({ name: "Gudang Utama", code: "GUDANG-UTAMA" })
        .returning({ id: schema.warehouses.id });

      await transaction.insert(schema.userWarehouses).values({
        userId: user.id,
        warehouseId: warehouse.id,
      });

      await transaction.insert(schema.locations).values([
        {
          warehouseId: warehouse.id,
          code: "KARANTINA",
          name: "Karantina QC",
          type: "quarantine",
        },
        {
          warehouseId: warehouse.id,
          code: "RETUR",
          name: "Barang Retur",
          type: "return",
        },
        {
          warehouseId: warehouse.id,
          code: "REJECT",
          name: "Barang Reject",
          type: "reject",
        },
        {
          warehouseId: warehouse.id,
          code: "RAK-01",
          name: "Rak 01",
          type: "storage",
        },
      ]);
    });

    console.info("Admin dan gudang utama berhasil dibuat.");
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Kesalahan tidak diketahui.";
  console.error(`Bootstrap gagal: ${message}`);
  process.exitCode = 1;
});
