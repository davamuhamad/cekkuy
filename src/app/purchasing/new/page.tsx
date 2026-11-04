import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { productVariants, products } from "@/db/schema";
import { requireRoles } from "@/lib/auth";
import { createPurchaseOrderAction } from "../actions";
import { PurchaseItemFields } from "./item-fields";

export default async function NewPurchaseOrder({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireRoles(["admin", "warehouse_manager", "purchasing"]);
  if (!user) redirect("/login");
  const { error } = await searchParams;
  const variants = await db.select({
    id: productVariants.id,
    sku: productVariants.sku,
    name: products.name,
    variant: productVariants.variantName,
    cost: productVariants.costPrice,
  }).from(productVariants).innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(eq(productVariants.isActive, true), eq(products.isActive, true))).orderBy(products.name).limit(1000);
  return <div className="page-content form-page">
    <div className="page-title-row"><div><div className="eyebrow">PEMBELIAN</div><h1>Buat purchase order</h1><p className="welcome-caption">PO langsung berstatus dikirim dan dapat diterima sebagian.</p></div><Link className="secondary-button" href="/purchasing">Kembali</Link></div>
    {error && <div className="form-error" role="alert">{error === "variants" ? "Varian tidak aktif." : "Pemasok, item PO, dan jumlah harus diisi dengan benar."}</div>}
    {!variants.length && <div className="form-error">Belum ada produk aktif.</div>}
    <form className="panel data-form" action={createPurchaseOrderAction}>
      <section className="form-section"><div className="form-section-heading"><h2>Detail pembelian</h2><p>Nomor PO dibuat otomatis setelah disimpan.</p></div><div className="form-grid">
        <label>Pemasok<input name="supplier" required minLength={2} maxLength={160} /></label>
        <label className="full-field">Catatan<textarea name="notes" rows={2} maxLength={500} /></label>
      </div></section>
      <section className="form-section"><div className="form-section-heading"><h2>Item purchase order</h2><p>Masukkan jumlah dan harga beli per SKU.</p></div><PurchaseItemFields variants={variants} /></section>
      <div className="form-actions"><Link className="secondary-button" href="/purchasing">Batal</Link><button className="primary-button" type="submit" disabled={!variants.length}>Simpan & kirim PO</button></div>
    </form>
  </div>;
}
