import { and, desc, eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { salesOrders, users } from "@/db/schema";
import { getUserWarehouse, requireRoles } from "@/lib/auth";

export const dynamic = "force-dynamic";

const statusNames: Record<string, string> = {
  awaiting_pick: "Menunggu picking",
  picking: "Picking / packing",
  packing: "Packing",
  qc_pending: "Menunggu QC packing",
  ready_to_ship: "Siap diserahkan",
  handed_over: "Diserahkan",
  delivered: "Terkirim sukses",
  failed: "Gagal kirim",
  returned: "Retur",
  cancelled: "Dibatalkan",
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  const user = await requireRoles(["admin", "warehouse_manager", "warehouse_staff", "qc", "online_ops", "management"]);
  const warehouseId = await getUserWarehouse(user.userId);
  const { created, error } = await searchParams;
  const rows = await db
    .select({
      id: salesOrders.id,
      trackingNumber: salesOrders.trackingNumber,
      status: salesOrders.status,
      shipBy: salesOrders.shipBy,
      isCod: salesOrders.isCod,
      reseller: users.name,
      createdAt: salesOrders.createdAt,
    })
    .from(salesOrders)
    .innerJoin(users, eq(salesOrders.resellerId, users.id))
    .where(eq(salesOrders.warehouseId, warehouseId))
    .orderBy(desc(salesOrders.createdAt))
    .limit(200);
  const canCreate = ["admin", "warehouse_manager", "online_ops"].includes(user.role);

  return (
    <div className="page-content">
      <div className="page-title-row"><div><div className="eyebrow">SALES ORDER · PENGIRIMAN</div><h1>Pesanan</h1><p className="welcome-caption">Reservasi, picking, packing, QC, dan serah-terima kurir.</p></div>{canCreate && <Link className="primary-button" href="/orders/new"><Plus size={17} /> Buat pesanan</Link>}</div>
      {created && <div className="form-success" role="status">Pesanan berhasil dibuat dan stok telah direservasi.</div>}
      {error && <div className="form-error" role="alert">{error === "scan" ? "Barcode atau jumlah scan tidak valid." : "Operasi gagal. Periksa stok dan status pesanan."}</div>}
      <section className="panel table-panel">
        <div className="table-toolbar"><div><h2>Antrean pesanan</h2><p>{rows.length} pesanan terakhir · maksimal 200</p></div></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Nomor resi</th><th>Reseller</th><th>Masuk</th><th>Batas kirim</th><th>COD</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}>
            <td><strong>{row.trackingNumber}</strong></td><td>{row.reseller}</td>
            <td>{new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(row.createdAt)}</td>
            <td>{row.shipBy ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(row.shipBy) : "—"}</td>
            <td>{row.isCod ? "Ya" : "Tidak"}</td>
            <td><span className={`status-pill ${row.status}`}>{statusNames[row.status] ?? row.status}</span></td>
            <td><Link className="text-link" href={`/orders/${row.id}`}>Buka →</Link></td>
          </tr>)}
          {!rows.length && <tr><td className="table-empty" colSpan={7}>Belum ada pesanan reseller.</td></tr>}</tbody>
        </table></div>
      </section>
    </div>
  );
}
