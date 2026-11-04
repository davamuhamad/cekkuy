import { and, desc, eq } from "drizzle-orm";
import { ClipboardCheck, Plus } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { locations, stockCounts } from "@/db/schema";
import { getUserWarehouse, requireRoles } from "@/lib/auth";

export const dynamic = "force-dynamic";

const statuses: Record<string, string> = {
  counting: "Sedang dihitung",
  review: "Menunggu persetujuan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

export default async function StockCountsPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string; error?: string }>;
}) {
  const user = await requireRoles([
    "admin",
    "warehouse_manager",
    "warehouse_staff",
  ]);
  const warehouseId = await getUserWarehouse(user.userId);
  const { cancelled, error } = await searchParams;
  const counts = await db
    .select({
      id: stockCounts.id,
      status: stockCounts.status,
      createdAt: stockCounts.createdAt,
      submittedAt: stockCounts.submittedAt,
      completedAt: stockCounts.completedAt,
      locationCode: locations.code,
      locationName: locations.name,
    })
    .from(stockCounts)
    .innerJoin(locations, eq(stockCounts.locationId, locations.id))
    .where(eq(stockCounts.warehouseId, warehouseId))
    .orderBy(desc(stockCounts.createdAt))
    .limit(200);
  const canCreate = ["admin", "warehouse_manager", "warehouse_staff"].includes(
    user.role,
  );

  return (
    <div className="page-content">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">PENGENDALIAN PERSEDIAAN</div>
          <h1>Stock opname</h1>
          <p className="welcome-caption">
            Hitung stok per lokasi, tahan pergerakan, lalu ajukan selisih untuk
            persetujuan.
          </p>
        </div>
        {canCreate && (
          <Link className="primary-button" href="/stock-counts/new">
            <Plus size={17} /> Mulai opname
          </Link>
        )}
      </div>
      {cancelled && (
        <div className="form-success" role="status">
          Sesi opname dibatalkan; pergerakan stok di lokasi sudah dibuka kembali.
        </div>
      )}
      {error && (
        <div className="form-error form-error-wide" role="alert">
          {error === "invalid"
            ? "Permintaan tidak valid."
            : "Sesi opname tidak dapat diproses."}
        </div>
      )}
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div>
            <h2>Riwayat dan antrean opname</h2>
            <p>{counts.length} sesi terakhir · maksimal 200</p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Lokasi</th>
                <th>Dimulai</th>
                <th>Status</th>
                <th>Pembaruan</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {counts.map((count) => (
                <tr key={count.id}>
                  <td>
                    <strong>{count.locationCode}</strong>
                    <small>{count.locationName}</small>
                  </td>
                  <td>
                    {new Intl.DateTimeFormat("id-ID", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(count.createdAt)}
                  </td>
                  <td>
                    <span className={`status-pill ${count.status}`}>
                      {statuses[count.status] ?? count.status}
                    </span>
                  </td>
                  <td>
                    {new Intl.DateTimeFormat("id-ID", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(count.completedAt ?? count.submittedAt ?? count.createdAt)}
                  </td>
                  <td>
                    <Link className="text-link" href={`/stock-counts/${count.id}`}>
                      Buka →
                    </Link>
                  </td>
                </tr>
              ))}
              {!counts.length && (
                <tr>
                  <td className="table-empty" colSpan={5}>
                    <ClipboardCheck size={20} /> Belum ada sesi stock opname.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
