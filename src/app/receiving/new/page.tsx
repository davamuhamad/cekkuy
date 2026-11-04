import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { productVariants, products, purchaseOrders, suppliers } from "@/db/schema";
import { getUserWarehouse, requireRoles } from "@/lib/auth";
import { createReceiptAction } from "../actions";
import { ReceiptItemFields } from "./item-fields";

const errors: Record<string, string> = {
  invalid: "Isi pemasok, produk, dan jumlah dengan benar. Satu varian hanya boleh muncul sekali.",
  location: "Lokasi karantina belum tersedia. Periksa konfigurasi gudang.",
  count_active: "Pergerakan ditahan karena salah satu lokasi sedang menjalani stock opname.",
  variants: "Salah satu varian sudah tidak aktif. Muat ulang halaman dan coba lagi.",
  po: "PO tidak valid atau jumlah penerimaan melebihi sisa jumlah PO.",
};

export default async function NewReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireRoles(["admin", "warehouse_manager", "warehouse_staff"]);
  const { error } = await searchParams;
  const warehouseId = await getUserWarehouse(user.userId);
  const variants = await db
    .select({
      id: productVariants.id,
      sku: productVariants.sku,
      name: products.name,
      variant: productVariants.variantName,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(eq(productVariants.isActive, true), eq(products.isActive, true)))
    .orderBy(products.name, productVariants.sku)
    .limit(1000);
  const purchaseOrderOptions = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      supplier: suppliers.name,
      status: purchaseOrders.status,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(
      and(
        eq(purchaseOrders.warehouseId, warehouseId),
        inArray(purchaseOrders.status, ["sent", "partial"]),
      ),
    )
    .orderBy(purchaseOrders.createdAt)
    .limit(100);

  return (
    <div className="page-content form-page">
      <div className="page-title-row">
        <div><div className="eyebrow">INBOUND · KARANTINA</div><h1>Catat penerimaan</h1><p className="welcome-caption">Barang yang diterima masuk ke karantina dan belum menambah stok jual.</p></div>
        <Link className="secondary-button" href="/receiving">Kembali</Link>
      </div>
      {error && <div className="form-error form-error-wide" role="alert">{errors[error] ?? errors.invalid}</div>}
      {!variants.length && <div className="form-error form-error-wide" role="alert">Belum ada varian aktif. Tambahkan produk terlebih dahulu.</div>}
      <form className="panel data-form" action={createReceiptAction}>
        <section className="form-section">
          <div className="form-section-heading"><h2>Informasi penerimaan</h2><p>Nomor penerimaan dibuat otomatis oleh sistem.</p></div>
          <div className="form-grid">
            <label>Purchase order (opsional)<select name="purchaseOrderId" defaultValue=""><option value="">Tanpa PO</option>{purchaseOrderOptions.map((po) => <option key={po.id} value={po.id}>{po.poNumber} · {po.supplier} · {po.status}</option>)}</select></label>
            <label>Pemasok (opsional) <input name="supplier" maxLength={160} placeholder="Nama pemasok" /></label>
            <label className="full-field">Catatan <textarea name="notes" maxLength={500} rows={2} placeholder="Nomor PO atau catatan penerimaan (opsional)" /></label>
          </div>
        </section>
        <section className="form-section">
          <div className="form-section-heading"><h2>Barang diterima</h2><p>Masukkan jumlah aktual yang diterima untuk tiap varian.</p></div>
          <ReceiptItemFields variants={variants} />
        </section>
        <div className="form-actions"><Link className="secondary-button" href="/receiving">Batal</Link><button className="primary-button" type="submit" disabled={!variants.length}>Simpan & kirim ke QC</button></div>
      </form>
    </div>
  );
}
