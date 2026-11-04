import { and, desc, eq, sql } from "drizzle-orm";
import { Plus } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { purchaseOrderItems, purchaseOrders, suppliers } from "@/db/schema";
import { getUserWarehouse, requireRoles } from "@/lib/auth";

export const dynamic = "force-dynamic";
export default async function PurchasingPage({ searchParams }: { searchParams: Promise<{ created?: string }> }) {
  const user = await requireRoles(["admin", "warehouse_manager", "purchasing", "warehouse_staff"]);
  const warehouseId = await getUserWarehouse(user.userId);
  const { created } = await searchParams;
  const rows = await db.select({
    id: purchaseOrders.id,
    poNumber: purchaseOrders.poNumber,
    supplier: suppliers.name,
    status: purchaseOrders.status,
    createdAt: purchaseOrders.createdAt,
    totalItems: sql<number>`count(${purchaseOrderItems.id})`,
  }).from(purchaseOrders).innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .leftJoin(purchaseOrderItems, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
    .where(eq(purchaseOrders.warehouseId, warehouseId))
    .groupBy(purchaseOrders.id, suppliers.name).orderBy(desc(purchaseOrders.createdAt)).limit(200);
  const canCreate = ["admin", "warehouse_manager", "purchasing"].includes(user.role);
  return <div className="page-content">
    <div className="page-title-row"><div><div className="eyebrow">PURCHASING</div><h1>Purchase order</h1><p className="welcome-caption">Pantau PO dan penerimaan barang sebagian atau penuh.</p></div>{canCreate && <Link className="primary-button" href="/purchasing/new"><Plus size={17} /> Buat PO</Link>}</div>
    {created && <div className="form-success" role="status">PO dibuat. Barang dapat diterima melalui menu penerimaan.</div>}
    <section className="panel table-panel"><div className="table-toolbar"><div><h2>Daftar PO</h2><p>{rows.length} purchase order · maksimal 200</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>Nomor PO</th><th>Pemasok</th><th>Dibuat</th><th>Item</th><th>Status</th></tr></thead><tbody>
        {rows.map((row) => <tr key={row.id}><td><strong>{row.poNumber}</strong></td><td>{row.supplier}</td><td>{new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(row.createdAt)}</td><td>{row.totalItems} SKU</td><td><span className={`status-pill ${row.status}`}>{row.status}</span></td></tr>)}
        {!rows.length && <tr><td className="table-empty" colSpan={5}>Belum ada purchase order.</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}
