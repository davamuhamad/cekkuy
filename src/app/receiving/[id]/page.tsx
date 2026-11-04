import { and, desc, eq, inArray } from "drizzle-orm";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  goodsReceipts,
  productVariants,
  products,
  qcInspections,
  receiptItems,
  suppliers,
  users,
} from "@/db/schema";
import { getUserWarehouse, requireRoles } from "@/lib/auth";
import { completeQcAction } from "../actions";

const errors: Record<string, string> = {
  invalid: "Lengkapi hasil QC untuk setiap varian.",
  note: "Catatan cacat wajib diisi untuk varian yang gagal QC.",
  count_active: "QC menunggu karena lokasi terkait sedang menjalani stock opname.",
};

export default async function ReceiptDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; qc?: string }>;
}) {
  const user = await requireRoles(["admin", "warehouse_manager", "warehouse_staff", "qc"]);
  const warehouseId = await getUserWarehouse(user.userId);
  const [{ id }, { error, qc }] = await Promise.all([params, searchParams]);
  if (!z.string().uuid().safeParse(id).success) notFound();
  const [receipt] = await db
    .select({
      id: goodsReceipts.id,
      receiptNumber: goodsReceipts.receiptNumber,
      status: goodsReceipts.status,
      receivedAt: goodsReceipts.receivedAt,
      notes: goodsReceipts.notes,
      supplier: suppliers.name,
    })
    .from(goodsReceipts)
    .leftJoin(suppliers, eq(goodsReceipts.supplierId, suppliers.id))
    .where(and(eq(goodsReceipts.id, id), eq(goodsReceipts.warehouseId, warehouseId)))
    .limit(1);
  if (!receipt) notFound();

  const items = await db
    .select({
      id: receiptItems.id,
      receivedQuantity: receiptItems.receivedQuantity,
      qcStatus: receiptItems.qcStatus,
      sku: productVariants.sku,
      variantName: productVariants.variantName,
      unit: productVariants.unit,
      productName: products.name,
    })
    .from(receiptItems)
    .innerJoin(productVariants, eq(receiptItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(eq(receiptItems.receiptId, receipt.id))
    .orderBy(products.name, productVariants.sku);

  const inspections = await db
    .select({
      receiptItemId: qcInspections.receiptItemId,
      result: qcInspections.result,
      notes: qcInspections.notes,
      inspectedAt: qcInspections.inspectedAt,
      inspector: users.name,
    })
    .from(qcInspections)
    .leftJoin(users, eq(qcInspections.inspectedBy, users.id))
    .where(
      inArray(
        qcInspections.receiptItemId,
        items.map((item) => item.id),
      ),
    )
    .orderBy(desc(qcInspections.inspectedAt));

  const inspectionByItem = new Map(inspections.map((inspection) => [inspection.receiptItemId, inspection]));
  const canInspect = ["admin", "warehouse_manager", "qc"].includes(user.role) && receipt.status === "qc_pending";

  return (
    <div className="page-content">
      <div className="page-title-row">
        <div><div className="eyebrow">PENERIMAAN · QC</div><h1>{receipt.receiptNumber}</h1><p className="welcome-caption">{receipt.supplier ?? "Tanpa pemasok"} · {new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(receipt.receivedAt)}</p></div>
        <Link className="secondary-button" href="/receiving"><ArrowLeft size={15} /> Daftar penerimaan</Link>
      </div>
      {error && <div className="form-error form-error-wide" role="alert">{errors[error] ?? "QC tidak dapat disimpan."}</div>}
      {qc && <div className="form-success" role="status">Hasil QC tersimpan. Stok lulus tersedia di rak; barang gagal masuk Reject.</div>}
      {receipt.notes && <div className="receipt-note">{receipt.notes}</div>}
      <section className="panel table-panel">
        <div className="table-toolbar"><div><h2>Barang diterima</h2><p>{items.length} varian · Status penerimaan: {receipt.status === "qc_pending" ? "menunggu QC" : "selesai"}</p></div></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Produk / SKU</th><th>Varian</th><th>Jumlah</th><th>Hasil QC terakhir</th><th>Catatan QC</th></tr></thead>
            <tbody>
              {items.map((item) => {
                const inspection = inspectionByItem.get(item.id);
                return (
                  <tr key={item.id}>
                    <td><strong>{item.productName}</strong><small><span className="sku-chip">{item.sku}</span></small></td>
                    <td>{item.variantName}</td>
                    <td>{Number(item.receivedQuantity).toLocaleString("id-ID")} {item.unit}</td>
                    <td>{item.qcStatus === "pending" ? "Menunggu pemeriksaan" : item.qcStatus === "passed" ? "Lulus" : "Gagal"}</td>
                    <td>{inspection?.notes ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {canInspect && (
        <form className="panel qc-form" action={completeQcAction}>
          <input type="hidden" name="receiptId" value={receipt.id} />
          <div className="form-section-heading"><span className="qc-heading-icon"><ClipboardCheck size={17} /></span><div><h2>Pemeriksaan QC</h2><p>Tentukan hasil untuk setiap varian. Catatan wajib jika barang gagal.</p></div></div>
          <div className="qc-lines">
            {items.map((item) => (
              <div className="qc-line" key={item.id}>
                <input type="hidden" name="itemId" value={item.id} />
                <div><strong>{item.productName} · {item.variantName}</strong><small>{item.sku} · {item.receivedQuantity} {item.unit}</small></div>
                <select name="result" defaultValue="passed" aria-label={`Hasil QC ${item.sku}`}><option value="passed">Lulus</option><option value="failed">Gagal</option></select>
                <input name="qcNote" maxLength={500} placeholder="Catatan cacat jika gagal" aria-label={`Catatan QC ${item.sku}`} />
              </div>
            ))}
          </div>
          <div className="form-actions"><button className="primary-button" type="submit">Simpan hasil QC</button></div>
        </form>
      )}
    </div>
  );
}
