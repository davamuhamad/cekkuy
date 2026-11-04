import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRoles } from "@/lib/auth";
import { createProductAction } from "../actions";
import { VariantFields } from "./variant-fields";

const errors: Record<string, string> = {
  invalid: "Periksa kembali nama produk dan nilai semua kolom varian.",
  variants: "Data varian harus lengkap dan setiap SKU harus unik.",
  duplicate: "SKU tersebut sudah digunakan. Gunakan SKU lain.",
};

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireRoles(["admin", "warehouse_manager", "purchasing"]);
  if (!user) redirect("/login");
  const { error } = await searchParams;

  return (
    <div className="page-content form-page">
      <div className="page-title-row">
        <div><div className="eyebrow">MASTER DATA</div><h1>Tambah produk</h1><p className="welcome-caption">Buat produk gudang beserta satu atau beberapa variannya.</p></div>
        <Link className="secondary-button" href="/products">Kembali ke produk</Link>
      </div>
      {error && <div className="form-error form-error-wide" role="alert">{errors[error] ?? errors.invalid}</div>}
      <form className="panel data-form" action={createProductAction}>
        <section className="form-section">
          <div className="form-section-heading"><h2>Informasi produk</h2><p>Nama produk dapat memiliki beberapa varian SKU.</p></div>
          <div className="form-grid">
            <label>Nama produk <input name="name" required maxLength={160} placeholder="Contoh: Topi Baseball" /></label>
            <label>Kategori <input name="category" maxLength={80} placeholder="Contoh: Aksesoris" /></label>
            <label className="full-field">Deskripsi <textarea name="description" rows={3} maxLength={1000} placeholder="Informasi tambahan (opsional)" /></label>
          </div>
        </section>
        <section className="form-section">
          <div className="form-section-heading"><h2>Varian & SKU</h2><p>SKU gudang unik per varian. Harga menggunakan rupiah.</p></div>
          <VariantFields />
        </section>
        <div className="form-actions"><Link className="secondary-button" href="/products">Batal</Link><button className="primary-button" type="submit">Simpan produk</button></div>
      </form>
    </div>
  );
}
