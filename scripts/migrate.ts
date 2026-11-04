import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "Migrasi dibatalkan: DATABASE_URL belum diatur. Isi file .env dengan URL PostgreSQL yang valid.",
    );
    process.exitCode = 1;
    return;
  }

  let validConnectionString = false;
  try {
    const url = new URL(connectionString);
    validConnectionString =
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.hostname.length > 0;
  } catch {
    validConnectionString = false;
  }

  if (!validConnectionString) {
    console.error(
      "Migrasi dibatalkan: DATABASE_URL tidak valid. Gunakan format postgresql://USER:PASSWORD@HOST:5432/DATABASE dan URL-encode karakter khusus pada username/password.",
    );
    process.exitCode = 1;
    return;
  }

  const client = postgres(connectionString, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
  });

  try {
    console.log("Memeriksa koneksi PostgreSQL (batas tunggu 10 detik)...");
    await client`select 1`;
    console.log("Koneksi berhasil. Menjalankan migrasi...");
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log("Migrasi selesai.");
  } catch (error) {
    const errorCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;
    if (errorCode === "ENETUNREACH" || errorCode === "EHOSTUNREACH") {
      console.error(
        `Migrasi gagal (${errorCode}): jaringan tidak memiliki rute ke alamat database. Jika memakai Supabase, ambil URL IPv4 dari Connect → Session Pooler dan perbarui DATABASE_URL di .env.`,
      );
      process.exitCode = 1;
      return;
    }
    const message =
      error instanceof Error ? error.message : "Kesalahan tidak diketahui.";
    console.error(`Migrasi gagal: ${message}`);
    process.exitCode = 1;
  } finally {
    await client.end({ timeout: 5 });
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Kesalahan tidak diketahui.";
  console.error(`Migrasi gagal: ${message}`);
  process.exitCode = 1;
});
