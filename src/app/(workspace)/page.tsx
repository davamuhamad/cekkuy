import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  ClipboardCheck,
  Package,
  PackageCheck,
  ScanLine,
  ShoppingBag,
  Truck,
} from "lucide-react";
import { and, count, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import {
  locations,
  productVariants,
  salesOrders,
  stockBalances,
  stockReservations,
} from "@/db/schema";
import { getSession, getUserWarehouse } from "@/lib/auth";

export const dynamic = "force-dynamic";

const workflow = [
  { label: "Menunggu picking", status: "awaiting_pick", icon: Package, tone: "blue" },
  { label: "Sedang packing", status: "packing", icon: ScanLine, tone: "violet" },
  { label: "Menunggu QC", status: "qc_pending", icon: ClipboardCheck, tone: "orange" },
  { label: "Siap diserahkan", status: "ready_to_ship", icon: Truck, tone: "green" },
];

export default async function DashboardPage() {
  const user = await getSession();
  if (!user) return null;
  const warehouseId = await getUserWarehouse(user.userId);

  const [skuCount] = await db
    .select({ value: count() })
    .from(productVariants)
    .where(eq(productVariants.isActive, true));

  const [stockResult] = await db
    .select({
      value: sql<string>`coalesce(sum(${stockBalances.quantity}), 0) - coalesce((
        SELECT sum(sr.quantity)
        FROM stock_reservations sr
        INNER JOIN locations rl ON rl.id = sr.location_id
        WHERE sr.warehouse_id = ${warehouseId}
          AND sr.released_at IS NULL
          AND rl.type = 'storage'
      ), 0)`,
    })
    .from(stockBalances)
    .innerJoin(locations, eq(stockBalances.locationId, locations.id))
    .where(and(eq(stockBalances.warehouseId, warehouseId), eq(locations.type, "storage")));

  const orderCounts = await db
    .select({ status: salesOrders.status, value: count() })
    .from(salesOrders)
    .where(eq(salesOrders.warehouseId, warehouseId))
    .groupBy(salesOrders.status);
  const countByStatus = new Map(orderCounts.map((entry) => [entry.status, entry.value]));
  const processingOrders = orderCounts
    .filter(({ status }) =>
      ["awaiting_pick", "picking", "packing", "qc_pending", "ready_to_ship"].includes(status),
    )
    .reduce((sum, entry) => sum + entry.value, 0);

  const [lowStock] = await db
    .select({ value: count(sql`DISTINCT ${productVariants.id}`) })
    .from(productVariants)
    .where(
      sql`${productVariants.isActive} = true AND (
        coalesce((
        SELECT sum(sb.quantity)
        FROM stock_balances sb
        INNER JOIN locations l ON l.id = sb.location_id
        WHERE sb.variant_id = ${productVariants.id}
          AND sb.warehouse_id = ${warehouseId}
          AND l.type = 'storage'
        ), 0) - coalesce((
          SELECT sum(sr.quantity)
          FROM stock_reservations sr
          INNER JOIN locations rl ON rl.id = sr.location_id
          WHERE sr.variant_id = ${productVariants.id}
            AND sr.warehouse_id = ${warehouseId}
            AND sr.released_at IS NULL
            AND rl.type = 'storage'
        ), 0)
      ) < ${productVariants.minimumStock}`,
    );

  const stockValue = Number(stockResult?.value ?? 0);
  const metrics = [
    { label: "Total SKU", value: String(skuCount?.value ?? 0), note: "Varian produk aktif", icon: Package, tone: "violet" },
    { label: "Stok tersedia", value: stockValue.toLocaleString("id-ID"), note: "Unit di lokasi penyimpanan", icon: Boxes, tone: "blue" },
    { label: "Perlu diproses", value: String(processingOrders), note: "Pesanan menunggu", icon: ShoppingBag, tone: "orange" },
    { label: "Stok menipis", value: String(lowStock?.value ?? 0), note: "Di bawah stok minimum", icon: AlertTriangle, tone: "red" },
  ];

  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <div className="eyebrow"><span className="live-dot" /> DASHBOARD GUDANG</div>
          <h1>Selamat datang, {user.name.split(" ")[0]} <span className="wave">✦</span></h1>
          <p className="welcome-caption">Pantau stok dan aktivitas gudangmu hari ini.</p>
        </div>
        <Link className="primary-button" href="/products/new"><Package size={17} /> Tambah produk</Link>
      </section>

      <section className="metric-grid" aria-label="Ringkasan stok">
        {metrics.map(({ label, value, note, icon: Icon, tone }) => (
          <article className="metric-card" key={label}>
            <div className="metric-top">
              <span className={`metric-icon ${tone}`}><Icon size={19} strokeWidth={1.9} /></span>
              <ArrowUpRight className="metric-trend" size={16} />
            </div>
            <div className="metric-value">{value}</div>
            <div className="metric-label">{label}</div>
            <div className="metric-note">{note}</div>
          </article>
        ))}
      </section>

      <section className="workflow-section">
        <div className="section-heading">
          <div><div className="eyebrow">ALUR HARI INI</div><h2>Proses pesanan</h2></div>
          <Link className="text-link" href="#modul-mvp">Lihat pesanan <ArrowRight size={15} /></Link>
        </div>
        <div className="workflow-grid">
          {workflow.map(({ label, status, icon: Icon, tone }, index) => (
            <article className="workflow-card" key={label}>
              <span className={`workflow-icon ${tone}`}><Icon size={18} /></span>
              <span className="workflow-index">0{index + 1}</span>
              <strong>{label}</strong>
              <div className="workflow-bottom"><span>{countByStatus.get(status as (typeof salesOrders.$inferSelect)["status"]) ?? 0} paket</span><span className="workflow-arrow">→</span></div>
            </article>
          ))}
        </div>
      </section>

      <section className="lower-grid">
        <article className="panel activity-panel">
          <div className="panel-heading">
            <div><h2>Mulai kelola stok</h2><p>Daftarkan produk lalu catat jumlah awal di gudang.</p></div>
            <Link className="icon-button" href="/inventory" aria-label="Buka persediaan"><ArrowRight size={17} /></Link>
          </div>
          <div className="empty-state">
            <div className="empty-illustration"><Boxes size={24} /></div>
            <strong>Stok dicatat transparan</strong>
            <p>Setiap penambahan dan pengurangan tersimpan di ledger pergerakan.</p>
          </div>
        </article>
        <article className="panel attention-panel">
          <div className="panel-heading">
            <div><h2>Perlu perhatian</h2><p>Hal yang perlu segera ditindaklanjuti</p></div>
            <span className="attention-count">{lowStock?.value ?? 0}</span>
          </div>
          <div className="attention-empty">
            <span className="check-circle"><PackageCheck size={18} /></span>
            <div><strong>{lowStock?.value ? "Ada stok yang perlu ditinjau" : "Semua aman"}</strong><p>{lowStock?.value ? "Periksa produk di bawah stok minimum." : "Belum ada stok menipis."}</p></div>
          </div>
          <div className="attention-footer"><span>Stok minimum dipantau otomatis</span><ArrowRight size={14} /></div>
        </article>
      </section>

      <section className="setup-banner" id="modul-mvp">
        <div className="setup-symbol"><Boxes size={22} /></div>
        <div className="setup-copy">
          <strong>Fondasi gudangmu sudah siap digunakan</strong>
          <p>Master produk dan pencatatan stok tersedia. Penerimaan QC dan proses pesanan menyusul.</p>
        </div>
        <span className="setup-phase">MVP · FASE 1</span>
      </section>
      <footer className="page-footer">Cekkuy <span>·</span> Sistem Manajemen Stok & Gudang</footer>
    </div>
  );
}
