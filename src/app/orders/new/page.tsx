import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { productVariants, products, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { createSalesOrderAction } from "../actions";
import { OrderItemFields } from "./item-fields";

const errors: Record<string, string> = {
  invalid: "Lengkapi nomor resi, SKU, jumlah, dan nominal COD dengan benar.",
  reseller: "Pilih akun reseller yang valid.",
  variants: "Salah satu varian sudah tidak aktif. Muat ulang halaman.",
  duplicate: "Nomor resi tersebut sudah pernah dimasukkan.",
  stock: "Stok tersedia tidak cukup untuk salah satu SKU. Pesanan tidak dibuat.",
  location: "Gudang belum memiliki lokasi penyimpanan.",
};

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const isReseller = user.role === "reseller";
  if (!isReseller && !["admin", "warehouse_manager", "online_ops"].includes(user.role)) {
    return <main className="page-content"><div className="form-error">Anda tidak memiliki izin membuat pesanan.</div></main>;
  }
  const { error } = await searchParams;
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
  const resellers = isReseller
    ? []
    : await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "reseller")).orderBy(users.name);

  return (
    <div className="page-content form-page">
      <div className="page-title-row"><div><div className="eyebrow">{isReseller ? "PORTAL RESELLER" : "SALES ORDER"}</div><h1>{isReseller ? "Unggah resi" : "Buat pesanan"}</h1><p className="welcome-caption">Stok akan direservasi otomatis saat pesanan disimpan.</p></div><Link className="secondary-button" href={isReseller ? "/portal" : "/orders"}>Kembali</Link></div>
      {error && <div className="form-error form-error-wide" role="alert">{errors[error] ?? errors.invalid}</div>}
      {!variants.length && <div className="form-error form-error-wide">Belum ada produk aktif. Hubungi pengelola gudang.</div>}
      <form className="panel data-form" action={createSalesOrderAction}>
        <section className="form-section">
          <div className="form-section-heading"><h2>Informasi paket</h2><p>Nomor resi unik digunakan saat scan packing dan serah-terima.</p></div>
          <div className="form-grid">
            {!isReseller && <label>Reseller<select name="resellerId" required defaultValue=""><option value="" disabled>Pilih reseller</option>{resellers.map((reseller) => <option key={reseller.id} value={reseller.id}>{reseller.name}</option>)}</select></label>}
            <label>Nomor resi<input name="trackingNumber" required maxLength={120} placeholder="SPX..." /></label>
            <label>Nama toko pengirim<input name="senderStore" maxLength={160} placeholder="Nama toko marketplace" /></label>
            <label>Batas kirim<input name="shipBy" type="date" /></label>
            <label>COD<select name="isCod" defaultValue="no"><option value="no">Bukan COD</option><option value="yes">Ya, COD</option></select></label>
            <label>Nominal COD (Rp)<input name="codAmount" type="number" min="0.01" step="0.01" placeholder="Isi jika COD" /></label>
          </div>
        </section>
        <section className="form-section">
          <div className="form-section-heading"><h2>Isi paket</h2><p>Satu resi boleh berisi banyak SKU. Setiap SKU hanya dimasukkan sekali.</p></div>
          <OrderItemFields variants={variants} />
        </section>
        <div className="form-actions"><Link className="secondary-button" href={isReseller ? "/portal" : "/orders"}>Batal</Link><button className="primary-button" type="submit" disabled={!variants.length}>Simpan & reservasi stok</button></div>
      </form>
    </div>
  );
}
