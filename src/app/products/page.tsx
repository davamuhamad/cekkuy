import { and, desc, eq, ilike } from "drizzle-orm";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { categories, productVariants, products } from "@/db/schema";
import { requireRoles } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; created?: string }>;
}) {
  const user = await requireRoles([
    "admin",
    "warehouse_manager",
    "warehouse_staff",
    "qc",
    "purchasing",
    "online_ops",
    "management",
  ]);
  const { q = "", created } = await searchParams;
  const search = q.trim().slice(0, 100);
  const conditions = search
    ? and(
        eq(products.isActive, true),
        ilike(products.name, `%${search}%`),
      )
    : eq(products.isActive, true);

  const rows = await db
    .select({
      id: productVariants.id,
      productId: products.id,
      name: products.name,
      category: categories.name,
      sku: productVariants.sku,
      barcode: productVariants.barcode,
      variantName: productVariants.variantName,
      unit: productVariants.unit,
      resellerPrice: productVariants.resellerPrice,
      minimumStock: productVariants.minimumStock,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(conditions, eq(productVariants.isActive, true)))
    .orderBy(desc(products.createdAt), productVariants.sku)
    .limit(200);

  const canCreate = ["admin", "warehouse_manager", "purchasing"].includes(user.role);

  return (
    <div className="page-content">
      <div className="page-title-row">
        <div><div className="eyebrow">MASTER DATA</div><h1>Produk & varian</h1><p className="welcome-caption">Kelola SKU, barcode, harga, dan stok minimum.</p></div>
        {canCreate && <Link className="primary-button" href="/products/new"><Plus size={17} /> Tambah produk</Link>}
      </div>
      {created && <div className="form-success" role="status">Produk berhasil disimpan.</div>}
      <section className="panel table-panel">
        <form className="table-toolbar" method="get">
          <div><h2>Daftar varian</h2><p>{rows.length} varian ditampilkan · maksimal 200</p></div>
          <div className="search-control"><Search size={16} /><input name="q" defaultValue={search} placeholder="Cari nama produk" aria-label="Cari nama produk" /><button className="secondary-button search-button" type="submit">Cari</button></div>
        </form>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Produk</th><th>SKU</th><th>Varian</th><th>Barcode</th><th>Harga reseller</th><th>Stok minimum</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong><small>{row.category ?? "Tanpa kategori"}</small></td>
                  <td><span className="sku-chip">{row.sku}</span></td>
                  <td>{row.variantName}</td>
                  <td>{row.barcode ?? "—"}</td>
                  <td>Rp {Number(row.resellerPrice).toLocaleString("id-ID")}</td>
                  <td>{row.minimumStock} {row.unit}</td>
                </tr>
              ))}
              {!rows.length && <tr><td className="table-empty" colSpan={6}>{search ? "Produk tidak ditemukan." : "Belum ada produk. Tambahkan produk pertama untuk memulai."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
