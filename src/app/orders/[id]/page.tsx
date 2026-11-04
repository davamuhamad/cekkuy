import { and, asc, eq, sql } from "drizzle-orm";
import {
  Ban,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  PackageCheck,
  ScanLine,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  codPayments,
  packingInspections,
  productVariants,
  products,
  salesOrderItems,
  salesOrders,
  users,
} from "@/db/schema";
import { getUserWarehouse, requireRoles } from "@/lib/auth";
import {
  cancelSalesOrderAction,
  completePackingQcAction,
  handoverOrderAction,
  recordPackingScanAction,
  requestPackingQcAction,
  startPickingAction,
  updateDeliveryOutcomeAction,
} from "../actions";

const errors: Record<string, string> = {
  state: "Status pesanan berubah. Muat ulang halaman.",
  scan: "Scan ditolak. Pastikan SKU benar dan jumlah tidak melebihi pesanan.",
  qc: "QC gagal dicatat. Jika gagal, isi catatan penyebab.",
  handover: "Serah-terima ditolak. Scan nomor resi harus sama dan QC harus lulus.",
  locked: "Status pengiriman hanya dapat diperbarui hingga 7 hari setelah serah-terima.",
  cancel: "Pembatalan hanya dapat dilakukan sebelum scan packing dimulai.",
  count_active: "Pengiriman stok ditahan karena lokasi sedang menjalani stock opname.",
};
const statuses: Record<string, string> = {
  awaiting_pick: "Menunggu picking",
  picking: "Picking & packing",
  qc_pending: "Menunggu QC packing",
  ready_to_ship: "Siap diserahkan",
  handed_over: "Diserahkan ke kurir",
  delivered: "Terkirim sukses",
  failed: "Gagal kirim",
  returned: "Retur",
  cancelled: "Dibatalkan",
};
const outcomes = [
  ["success", "Sukses diterima"],
  ["failed", "Gagal kirim"],
  ["returned", "Retur"],
  ["cancelled", "Batal"],
] as const;

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    qc?: string;
    handover?: string;
    cancelled?: string;
  }>;
}) {
  const user = await requireRoles(["admin", "warehouse_manager", "warehouse_staff", "qc", "online_ops"]);
  const warehouseId = await getUserWarehouse(user.userId);
  const [{ id }, { error, qc, handover, cancelled }] = await Promise.all([
    params,
    searchParams,
  ]);
  if (!z.string().uuid().safeParse(id).success) notFound();

  const [order] = await db
    .select({
      id: salesOrders.id,
      resellerId: salesOrders.resellerId,
      trackingNumber: salesOrders.trackingNumber,
      senderStore: salesOrders.senderStore,
      status: salesOrders.status,
      deliveryOutcome: salesOrders.deliveryOutcome,
      outcomeUpdatedAt: salesOrders.outcomeUpdatedAt,
      handedOverAt: salesOrders.handedOverAt,
      isCod: salesOrders.isCod,
      codAmount: salesOrders.codAmount,
      shipBy: salesOrders.shipBy,
      packingType: salesOrders.packingType,
      reseller: users.name,
    })
    .from(salesOrders)
    .innerJoin(users, eq(salesOrders.resellerId, users.id))
    .where(and(eq(salesOrders.id, id), eq(salesOrders.warehouseId, warehouseId)))
    .limit(1);
  if (!order) notFound();

  const items = await db
    .select({
      id: salesOrderItems.id,
      variantId: salesOrderItems.variantId,
      quantity: salesOrderItems.quantity,
      unitPrice: salesOrderItems.unitPrice,
      sku: productVariants.sku,
      barcode: productVariants.barcode,
      variantName: productVariants.variantName,
      unit: productVariants.unit,
      productName: products.name,
      scanned: sql<string>`coalesce((SELECT sum(ps.quantity) FROM packing_scans ps WHERE ps.order_item_id = ${salesOrderItems.id}), 0)`,
    })
    .from(salesOrderItems)
    .innerJoin(productVariants, eq(salesOrderItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(eq(salesOrderItems.orderId, id))
    .orderBy(asc(productVariants.sku));

  const [cod] = order.isCod
    ? await db.select().from(codPayments).where(eq(codPayments.orderId, order.id)).limit(1)
    : [];
  const [lastQc] = await db
    .select()
    .from(packingInspections)
    .where(eq(packingInspections.orderId, order.id))
    .orderBy(sql`${packingInspections.inspectedAt} DESC`)
    .limit(1);

  const staffCanProcess = ["admin", "warehouse_manager", "warehouse_staff"].includes(user.role);
  const qcCanInspect = ["admin", "warehouse_manager", "qc"].includes(user.role);
  const totalMatches = items.length > 0 && items.every((item) => Number(item.scanned) === Number(item.quantity));
  const canCancel =
    ["admin", "warehouse_manager", "online_ops"].includes(user.role) &&
    ["awaiting_pick", "picking"].includes(order.status) &&
    items.every((item) => Number(item.scanned) === 0);
  const cutoff = order.handedOverAt
    ? new Date(order.handedOverAt.getTime() + 7 * 24 * 60 * 60 * 1000)
    : null;
  const canUpdateOutcome =
    order.status === "handed_over" &&
    cutoff !== null &&
    Date.now() <= cutoff.getTime() &&
    (user.role === "admin" || user.role === "online_ops" || user.userId === order.resellerId);

  return (
    <div className="page-content">
      <div className="page-title-row">
        <div><div className="eyebrow">SALES ORDER · CHECKLIST PAKET</div><h1>{order.trackingNumber}</h1><p className="welcome-caption">{order.reseller} · {order.senderStore ?? "Tanpa nama toko"}{order.isCod ? ` · COD Rp ${Number(order.codAmount).toLocaleString("id-ID")}` : ""}</p></div>
        <Link className="secondary-button" href="/orders"><ArrowLeft size={15} /> Daftar pesanan</Link>
      </div>
      {error && <div className="form-error form-error-wide" role="alert">{errors[error] ?? "Perubahan pesanan tidak berhasil."}</div>}
      {handover && <div className="form-success" role="status">Serah-terima kurir tercatat. Reseller dapat memperbarui hasil kirim dalam 7 hari.</div>}
      {qc && <div className="form-success" role="status">{qc === "passed" ? "QC packing lulus. Stok fisik terpotong di ledger." : qc === "failed" ? "QC gagal. Paket dikembalikan ke proses packing." : "Paket masuk antrean QC packing."}</div>}
      {cancelled && <div className="form-success" role="status">Pesanan dibatalkan dan reservasi stok dilepas.</div>}

      <div className="order-summary-grid">
        <article className="panel order-summary"><span>Status paket</span><strong><span className={`status-pill ${order.status}`}>{statuses[order.status] ?? order.status}</span></strong></article>
        <article className="panel order-summary"><span>Batas kirim</span><strong>{order.shipBy ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(order.shipBy) : "Tidak ditentukan"}</strong></article>
        <article className="panel order-summary"><span>Tipe packing</span><strong>{order.packingType?.replaceAll("_", " ") ?? "Belum dipilih"}</strong></article>
        {cod && <article className="panel order-summary"><span>Status COD</span><strong>{cod.status === "pending" ? "Menunggu konfirmasi" : cod.status === "paid" ? "Lunas" : cod.status === "discrepancy" ? "Ada selisih" : "Tidak ada tagihan"}</strong></article>}
      </div>

      {canCancel && (
        <section className="panel order-step">
          <span className="step-icon orange"><Ban size={18} /></span>
          <div className="step-copy"><h2>Batalkan pesanan</h2><p>Hanya dapat dibatalkan sebelum barang mulai dipindai saat packing.</p></div>
          <form action={cancelSalesOrderAction}>
            <input type="hidden" name="orderId" value={order.id} />
            <button className="secondary-button" type="submit">Batalkan & lepas reservasi</button>
          </form>
        </section>
      )}

      <section className="panel table-panel">
        <div className="table-toolbar"><div><h2>Isi paket</h2><p>Scan setiap barang saat packing. Jumlah harus sesuai untuk semua SKU.</p></div><span className={`scan-progress${totalMatches ? " complete" : ""}`}>{items.filter((item) => Number(item.scanned) === Number(item.quantity)).length}/{items.length} SKU cocok</span></div>
        <div className="table-scroll"><table>
          <thead><tr><th>SKU / Barcode</th><th>Produk</th><th>Dipesan</th><th>Sudah discan</th><th>Validasi</th></tr></thead>
          <tbody>{items.map((item) => {
            const matches = Number(item.scanned) === Number(item.quantity);
            return <tr key={item.id}><td><strong>{item.sku}</strong><small>{item.barcode ?? "Barcode belum diatur"}</small></td><td>{item.productName} · {item.variantName}</td><td>{item.quantity} {item.unit}</td><td>{item.scanned} {item.unit}</td><td>{matches ? <span className="scan-match"><CheckCircle2 size={14} /> Cocok</span> : <span className="scan-pending">Belum cocok</span>}</td></tr>;
          })}</tbody>
        </table></div>
      </section>

      {order.status === "awaiting_pick" && staffCanProcess && (
        <section className="panel order-step">
          <span className="step-icon blue"><PackageCheck size={18} /></span><div className="step-copy"><h2>Mulai picking</h2><p>Stok sudah dipesan dan daftar item siap diambil dari rak.</p></div>
          <form action={startPickingAction}><input type="hidden" name="orderId" value={order.id} /><button className="primary-button" type="submit">Mulai picking</button></form>
        </section>
      )}

      {order.status === "picking" && staffCanProcess && (
        <section className="panel order-step-form">
          <div className="form-section-heading"><span className="step-icon violet"><ScanLine size={18} /></span><div><h2>Scan barang untuk packing</h2><p>Masukkan SKU gudang atau barcode, lalu jumlah hasil scan.</p></div></div>
          <form className="scan-form" action={recordPackingScanAction}>
            <input type="hidden" name="orderId" value={order.id} />
            <label>SKU / barcode<input name="barcode" autoFocus required maxLength={80} placeholder="Scan barcode produk" /></label>
            <label>Jumlah<input name="quantity" type="number" min="0.001" step="0.001" defaultValue="1" required /></label>
            <button className="primary-button" type="submit">Catat scan</button>
          </form>
          <form className="form-actions compact-actions" action={requestPackingQcAction}>
            <input type="hidden" name="orderId" value={order.id} />
            <button className="secondary-button" type="submit" disabled={!totalMatches}><ClipboardCheck size={15} /> Kirim ke QC packing</button>
          </form>
          {!totalMatches && <p className="scan-hint">Semua SKU dan jumlah harus cocok sebelum QC packing.</p>}
        </section>
      )}

      {order.status === "qc_pending" && qcCanInspect && (
        <form className="panel qc-form" action={completePackingQcAction}>
          <input type="hidden" name="orderId" value={order.id} />
          <div className="form-section-heading"><span className="qc-heading-icon"><ClipboardCheck size={17} /></span><div><h2>QC packing</h2><p>Periksa isi paket sesuai resi, lalu pilih tipe kemasan.</p></div></div>
          {lastQc?.result === "failed" && <div className="form-error">Pemeriksaan sebelumnya gagal: {lastQc.notes ?? "periksa dan packing ulang"}</div>}
          <div className="form-grid packing-qc-grid">
            <label>Hasil pemeriksaan<select name="result" defaultValue="passed"><option value="passed">Lulus</option><option value="failed">Gagal — kembalikan ke packing</option></select></label>
            <label>Tipe packing<select name="packingType" defaultValue="plastic"><option value="plastic">Plastik</option><option value="bubble_wrap">Bubble wrap</option><option value="cardboard">Kardus</option><option value="other">Lainnya</option></select></label>
            <label className="full-field">Catatan penyebab jika gagal<textarea name="notes" rows={2} maxLength={500} placeholder="Wajib diisi bila QC gagal" /></label>
          </div>
          <div className="form-actions"><button className="primary-button" type="submit">Simpan hasil QC</button></div>
        </form>
      )}

      {order.status === "ready_to_ship" && staffCanProcess && (
        <section className="panel order-step-form">
          <div className="form-section-heading"><span className="step-icon green"><Truck size={18} /></span><div><h2>Serah-terima kurir</h2><p>Scan nomor resi pada paket. Stok hanya keluar dari sistem setelah QC packing lulus.</p></div></div>
          <form className="scan-form" action={handoverOrderAction}><input type="hidden" name="orderId" value={order.id} /><label>Scan nomor resi<input name="trackingNumber" required maxLength={120} placeholder="Scan resi paket" /></label><button className="primary-button" type="submit">Konfirmasi serah-terima</button></form>
        </section>
      )}

      {canUpdateOutcome && (
        <section className="panel order-step-form">
          <div className="form-section-heading"><span className="step-icon orange"><Truck size={18} /></span><div><h2>Hasil pengiriman reseller</h2><p>Perbarui maksimal 7 hari setelah serah-terima. Status ini menjadi dasar tagihan bulanan.</p></div></div>
          <form className="outcome-form" action={updateDeliveryOutcomeAction}><input type="hidden" name="orderId" value={order.id} /><select name="outcome" defaultValue=""><option value="" disabled>Pilih hasil pengiriman</option>{outcomes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="primary-button" type="submit">Simpan hasil kirim</button></form>
        </section>
      )}
      {order.status === "handed_over" && !canUpdateOutcome && <div className="inventory-note"><Truck size={16} /><span>Batas pembaruan hasil kirim telah lewat atau Anda bukan pemilik pesanan.</span></div>}
    </div>
  );
}
