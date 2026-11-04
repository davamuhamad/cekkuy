import { and, eq, sql } from "drizzle-orm";
import { ArrowDownToLine, ArrowUpFromLine, Boxes } from "lucide-react";
import { db } from "@/db";
import {
  locations,
  productVariants,
  products,
} from "@/db/schema";
import { requireRoles, getUserWarehouse } from "@/lib/auth";
import { adjustStockAction } from "./actions";

export const dynamic = "force-dynamic";

const errors: Record<string, string> = {
  invalid: "Isi jumlah yang valid dan alasan minimal 5 karakter.",
  insufficient: "Stok di lokasi penyimpanan tidak mencukupi untuk pengurangan ini.",
  location: "Gudang belum memiliki lokasi penyimpanan. Tambahkan lokasi melalui pengaturan.",
  count_active: "Pergerakan ditahan karena lokasi sedang menjalani stock opname.",
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; updated?: string }>;
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
  const warehouseId = await getUserWarehouse(user.userId);
  const { error, updated } = await searchParams;

  const rows = await db
    .select({
      id: productVariants.id,
      name: products.name,
      sku: productVariants.sku,
      variantName: productVariants.variantName,
      unit: productVariants.unit,
      minimumStock: productVariants.minimumStock,
      onHand: sql<string>`coalesce((
        SELECT sum(sb.quantity)
        FROM stock_balances sb
        INNER JOIN locations l ON l.id = sb.location_id
        WHERE sb.variant_id = ${productVariants.id}
          AND sb.warehouse_id = ${warehouseId}
          AND l.type = 'storage'
      ), 0)`,
      reserved: sql<string>`coalesce((
        SELECT sum(sr.quantity)
        FROM stock_reservations sr
        INNER JOIN locations l ON l.id = sr.location_id
        WHERE sr.variant_id = ${productVariants.id}
          AND sr.warehouse_id = ${warehouseId}
          AND sr.released_at IS NULL
          AND l.type = 'storage'
      ), 0)`,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(eq(productVariants.isActive, true), eq(products.isActive, true)))
    .orderBy(products.name, productVariants.sku)
    .limit(500);

  const canAdjust = ["admin", "warehouse_manager"].includes(user.role);
  const storageAvailable = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.warehouseId, warehouseId), eq(locations.type, "storage")))
    .limit(1);

  return (
    <div className="page-content">
      <div className="page-title-row">
        <div><div className="eyebrow">GUDANG UTAMA</div><h1>Persediaan</h1><p className="welcome-caption">Stok tersedia dihitung dari saldo penyimpanan dikurangi reservasi.</p></div>
      </div>
      {updated && <div className="form-success" role="status">Penyesuaian stok berhasil dicatat di ledger.</div>}
      {error && <div className="form-error form-error-wide" role="alert">{errors[error] ?? "Perubahan stok gagal."}</div>}
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div><h2>Stok per varian</h2><p>{rows.length} varian · maksimal 500</p></div>
          <span className="stock-legend"><i /> Tersedia untuk dijual</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Produk / SKU</th><th>Varian</th><th>Stok di rak</th><th>Dipesan</th><th>Tersedia</th><th>Stok minimum</th>{canAdjust && <th>Penyesuaian</th>}</tr></thead>
            <tbody>
              {rows.map((row) => {
                const available = Number(row.onHand) - Number(row.reserved);
                return (
                  <tr key={row.id}>
                    <td><strong>{row.name}</strong><small><span className="sku-chip">{row.sku}</span></small></td>
                    <td>{row.variantName}</td>
                    <td>{Number(row.onHand).toLocaleString("id-ID")} {row.unit}</td>
                    <td>{Number(row.reserved).toLocaleString("id-ID")} {row.unit}</td>
                    <td><span className={`stock-value${available < row.minimumStock ? " stock-low" : ""}`}>{available.toLocaleString("id-ID")} {row.unit}</span></td>
                    <td>{row.minimumStock} {row.unit}</td>
                    {canAdjust && (
                      <td>
                        <form className="inline-adjust-form" action={adjustStockAction}>
                          <input type="hidden" name="variantId" value={row.id} />
                          <select name="direction" aria-label="Arah penyesuaian">
                            <option value="in">Tambah</option><option value="out">Kurangi</option>
                          </select>
                          <input name="quantity" type="number" min="0.001" step="0.001" required aria-label="Jumlah penyesuaian" />
                          <input name="reason" required minLength={5} maxLength={500} placeholder="Alasan" aria-label="Alasan penyesuaian" />
                          <button className="icon-button adjust-submit" type="submit" aria-label="Simpan penyesuaian"><ArrowDownToLine size={15} /></button>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!rows.length && <tr><td className="table-empty" colSpan={canAdjust ? 7 : 6}><Boxes size={20} /> Belum ada varian produk. Tambahkan produk terlebih dahulu.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {canAdjust && (
        <div className="inventory-note">
          <ArrowUpFromLine size={16} />
          <span>Penyesuaian hanya untuk admin/kepala gudang, wajib diberi alasan, dan tidak mengubah histori ledger.</span>
          {!storageAvailable.length && <strong> Lokasi storage belum tersedia.</strong>}
        </div>
      )}
    </div>
  );
}
