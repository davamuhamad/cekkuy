import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { locations } from "@/db/schema";
import { getUserWarehouse, requireRoles } from "@/lib/auth";
import { createStockCountAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewStockCountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireRoles([
    "admin",
    "warehouse_manager",
    "warehouse_staff",
  ]);
  const warehouseId = await getUserWarehouse(user.userId);
  const { error } = await searchParams;
  const availableLocations = await db
    .select({
      id: locations.id,
      code: locations.code,
      name: locations.name,
      type: locations.type,
    })
    .from(locations)
    .where(eq(locations.warehouseId, warehouseId))
    .orderBy(asc(locations.code));
  const errors: Record<string, string> = {
    invalid: "Pilih lokasi yang valid.",
    location: "Lokasi tidak ditemukan di gudang akun Anda.",
    active: "Lokasi tersebut masih memiliki sesi opname yang belum selesai.",
    picking:
      "Opname belum dapat dimulai karena ada pesanan yang sedang dipicking dari lokasi ini.",
    empty: "Tidak ada varian aktif atau saldo stok di lokasi ini.",
  };

  return (
    <div className="page-content">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">PENGENDALIAN PERSEDIAAN</div>
          <h1>Mulai stock opname</h1>
          <p className="welcome-caption">
            Opname mengunci pergerakan di lokasi sampai disetujui atau
            dibatalkan.
          </p>
        </div>
        <Link className="secondary-button" href="/stock-counts">
          <ArrowLeft size={15} /> Kembali
        </Link>
      </div>
      {error && (
        <div className="form-error form-error-wide" role="alert">
          {errors[error] ?? "Sesi opname tidak dapat dibuat."}
        </div>
      )}
      <section className="panel form-panel">
        <div className="form-section-heading">
          <span className="step-icon violet">
            <ArrowLeft size={18} />
          </span>
          <div>
            <h2>Pilih lokasi yang akan dihitung</h2>
            <p>
              Saldo sistem untuk varian di lokasi disimpan sebagai angka awal
              pembanding.
            </p>
          </div>
        </div>
        {availableLocations.length ? (
          <form action={createStockCountAction}>
            <div className="form-grid">
              <label>
                Lokasi gudang
                <select name="locationId" required defaultValue="">
                  <option value="" disabled>
                    Pilih lokasi
                  </option>
                  {availableLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} · {location.name} (
                      {location.type.replaceAll("_", " ")})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-actions">
              <Link className="secondary-button" href="/stock-counts">
                Batal
              </Link>
              <button className="primary-button" type="submit">
                Buat sesi opname
              </button>
            </div>
          </form>
        ) : (
          <div className="inventory-note">
            Belum ada lokasi gudang yang dapat dihitung.
          </div>
        )}
      </section>
    </div>
  );
}
