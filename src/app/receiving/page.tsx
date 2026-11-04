import { and, count, desc, eq } from "drizzle-orm";
import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { goodsReceipts, receiptItems, suppliers } from "@/db/schema";
import { getUserWarehouse, requireRoles } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requireRoles(["admin", "warehouse_manager", "warehouse_staff", "qc"]);
  const warehouseId = await getUserWarehouse(user.userId);
  const { created } = await searchParams;

  const rows = await db
    .select({
      id: goodsReceipts.id,
      receiptNumber: goodsReceipts.receiptNumber,
      status: goodsReceipts.status,
      receivedAt: goodsReceipts.receivedAt,
      supplier: suppliers.name,
      itemCount: count(receiptItems.id),
    })
    .from(goodsReceipts)
    .leftJoin(suppliers, eq(goodsReceipts.supplierId, suppliers.id))
    .leftJoin(receiptItems, eq(goodsReceipts.id, receiptItems.receiptId))
    .where(eq(goodsReceipts.warehouseId, warehouseId))
    .groupBy(goodsReceipts.id, suppliers.name)
    .orderBy(desc(goodsReceipts.receivedAt))
    .limit(100);

  return (
    <div className="page-content">
      <div className="page-title-row">
        <div><div className="eyebrow">INBOUND · QC</div><h1>Penerimaan barang</h1><p className="welcome-caption">Barang masuk dikarantina sampai hasil QC dicatat.</p></div>
        {["admin", "warehouse_manager", "warehouse_staff"].includes(user.role) && <Link className="primary-button" href="/receiving/new"><Plus size={17} /> Catat penerimaan</Link>}
      </div>
      {created && <div className="form-success" role="status">Penerimaan dicatat. Barang menunggu QC di lokasi karantina.</div>}
      <section className="panel table-panel">
        <div className="table-toolbar"><div><h2>Riwayat penerimaan</h2><p>{rows.length} penerimaan terakhir · maksimal 100</p></div></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Nomor penerimaan</th><th>Pemasok</th><th>Tanggal</th><th>Item</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.receiptNumber}</strong></td>
                  <td>{row.supplier ?? "Tanpa pemasok"}</td>
                  <td>{new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(row.receivedAt)}</td>
                  <td>{row.itemCount} varian</td>
                  <td><span className={`status-pill ${row.status}`}>{row.status === "qc_pending" ? "Menunggu QC" : "Selesai"}</span></td>
                  <td><Link className="text-link" href={`/receiving/${row.id}`}>Detail <ArrowRight size={14} /></Link></td>
                </tr>
              ))}
              {!rows.length && <tr><td className="table-empty" colSpan={6}>Belum ada penerimaan barang.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
