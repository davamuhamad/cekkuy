import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL belum diatur. Isi variabel tersebut di file .env dengan URL PostgreSQL yang valid.",
  );
}

try {
  const parsedUrl = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(parsedUrl.protocol) ||
    !parsedUrl.hostname
  ) {
    throw new Error();
  }
} catch {
  throw new Error(
    "DATABASE_URL tidak valid. Gunakan format postgresql://USER:PASSWORD@HOST:5432/DATABASE dan URL-encode karakter khusus pada USER/PASSWORD (misalnya # menjadi %23).",
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
