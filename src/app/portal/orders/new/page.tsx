import { and, eq } from "drizzle-orm";
import { PackageCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { productVariants, products } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { createSalesOrderAction } from "@/app/orders/actions";
import { OrderItemFields } from "@/app/orders/new/item-fields";

const errors: Record<string, string> = {
  invalid: "Lengkapi nomor resi, SKU, jumlah, dan nominal COD dengan benar.",
  reseller: "Akun reseller belum tersedia.",
  variants: "Salah satu varian sudah tidak aktif. Muat ulang halaman.",
  duplicate: "Nomor resi tersebut sudah pernah dimasukkan.",
  stock: "Stok tidak cukup untuk salah satu SKU. Pesanan belum dibuat.",
  location: "Gudang belum memiliki lokasi penyimpanan.",
};

export default async function PortalNewOrder({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "reseller") redirect("/");
  const { error } = await searchParams;
  const variants = await db
    .select({ id: productVariants.id, sku: productVariants.sku, name: products.name, variant: productVariants.variantName })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(eq(productVariants.isActive, true), eq(products.isActive, true)))
    .orderBy(products.name, productVariants.sku)
    .limit(1000);
  return (
    <main className="portal-page">
      <header className="portal-header"><Link className="brand" href="/portal"><span className="brand-mark"><PackageCheck size={20} /></span><span className="brand-name">cekkuy<span>.</span></span></Link><Link className="secondary-button" href="/portal">Kembali</Link></header>
      <div className="portal-content form-page">
        <div className="page-title-row"><div><div className="eyebrow">PORTAL RESELLER</div><h1>Unggah pesanan</h1><p className="welcome-caption">Isi detail resi dan pilih SKU gudang. Stok direservasi otomatis.</p></div></div>
        {error && <div className="form-error" role="alert">{errors[error] ?? errors.invalid}</div>}
        <form className="panel data-form" action={createSalesOrderAction}>
          <section className="form-section"><div className="form-section-heading"><h2>Detail paket</h2><p>Nomor resi harus unik; COD perlu nominal.</p></div><div className="form-grid">
            <label>Nomor resi<input name="trackingNumber" required maxLength={120} placeholder="SPX..." /></label>
            <label>Nama toko pengirim<input name="senderStore" maxLength={160} /></label>
            <label>Batas kirim<input name="shipBy" type="date" /></label>
            <label>COD<select name="isCod" defaultValue="no"><option value="no">Bukan COD</option><option value="yes">Ya, COD</option></select></label>
            <label>Nominal COD (Rp)<input name="codAmount" type="number" min="0.01" step="0.01" /></label>
          </div></section>
          <section className="form-section"><div className="form-section-heading"><h2>Isi paket</h2><p>Pilih varian SKU gudang dan jumlah.</p></div><OrderItemFields variants={variants} /></section>
          <div className="form-actions"><Link className="secondary-button" href="/portal">Batal</Link><button className="primary-button" type="submit" disabled={!variants.length}>Simpan & reservasi stok</button></div>
        </form>
      </div>
    </main>
  );
}
