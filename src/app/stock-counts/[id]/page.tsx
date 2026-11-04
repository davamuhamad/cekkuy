import { and, asc, eq } from "drizzle-orm";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  LockKeyhole,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  locations,
  productVariants,
  products,
  stockCountItems,
  stockCounts,
  users,
} from "@/db/schema";
import { stockCountDifference } from "@/db/stock-count";
import { getUserWarehouse, requireRoles } from "@/lib/auth";
import {
  approveStockCountAction,
  cancelStockCountAction,
  recordStockCountItemAction,
  submitStockCountAction,
} from "../actions";

export const dynamic = "force-dynamic";

const statuses: Record<string, string> = {
  counting: "Sedang dihitung",
  review: "Menunggu persetujuan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

const errors: Record<string, string> = {
  invalid: "Jumlah harus berupa angka nol atau lebih, maksimal tiga angka desimal.",
  locked: "Sesi opname sudah berubah status atau tidak tersedia.",
  item: "Item tidak termasuk dalam sesi opname ini.",
  incomplete: "Hitung dan simpan semua SKU sebelum mengajukan atau menyetujui opname.",
  reserved:
    "Selisih pengurangan melebihi stok yang tidak direservasi. Selesaikan pesanan terkait sebelum menyetujui.",
};

function quantity(value: string) {
  return Number(value).toLocaleString("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

export default async function StockCountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    approved?: string;
    submitted?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const user = await requireRoles([
    "admin",
    "warehouse_manager",
    "warehouse_staff",
  ]);
  const warehouseId = await getUserWarehouse(user.userId);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!z.string().uuid().safeParse(id).success) notFound();

  const [count] = await db
    .select({
      id: stockCounts.id,
      status: stockCounts.status,
      createdAt: stockCounts.createdAt,
      submittedAt: stockCounts.submittedAt,
      completedAt: stockCounts.completedAt,
      createdBy: stockCounts.createdBy,
      locationId: stockCounts.locationId,
      locationCode: locations.code,
      locationName: locations.name,
      creatorName: users.name,
    })
    .from(stockCounts)
    .innerJoin(locations, eq(stockCounts.locationId, locations.id))
    .leftJoin(users, eq(stockCounts.createdBy, users.id))
    .where(
      and(
        eq(stockCounts.id, id),
        eq(stockCounts.warehouseId, warehouseId),
      ),
    )
    .limit(1);
  if (!count) notFound();

  const items = await db
    .select({
      id: stockCountItems.id,
      variantId: stockCountItems.variantId,
      expected: stockCountItems.expectedQuantity,
      counted: stockCountItems.countedQuantity,
      countedBy: stockCountItems.countedBy,
      countedAt: stockCountItems.countedAt,
      sku: productVariants.sku,
      barcode: productVariants.barcode,
      variantName: productVariants.variantName,
      unit: productVariants.unit,
      productName: products.name,
    })
    .from(stockCountItems)
    .innerJoin(
      productVariants,
      eq(stockCountItems.variantId, productVariants.id),
    )
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(eq(stockCountItems.stockCountId, count.id))
    .orderBy(asc(products.name), asc(productVariants.sku));

  const canCount =
    count.status === "counting" &&
    ["admin", "warehouse_manager", "warehouse_staff"].includes(user.role);
  const canApprove =
    count.status === "review" &&
    ["admin", "warehouse_manager"].includes(user.role);
  const completeCount = items.every((item) => item.counted !== null);
  const canCancel =
    ["counting", "review"].includes(count.status) &&
    (["admin", "warehouse_manager"].includes(user.role) ||
      (user.role === "warehouse_staff" &&
        count.createdBy === user.userId &&
        count.status === "counting"));
  const varianceItems = items.filter(
    (item) =>
      item.counted !== null &&
      stockCountDifference(item.expected, item.counted) !== 0,
  ).length;

  return (
    <div className="page-content">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">SESI STOCK OPNAME</div>
          <h1>
            {count.locationCode} · {count.locationName}
          </h1>
          <p className="welcome-caption">
            Dimulai{" "}
            {new Intl.DateTimeFormat("id-ID", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(count.createdAt)}
            {count.creatorName ? ` oleh ${count.creatorName}` : ""}
          </p>
        </div>
        <Link className="secondary-button" href="/stock-counts">
          <ArrowLeft size={15} /> Daftar opname
        </Link>
      </div>
      {query.approved && (
        <div className="form-success" role="status">
          Opname disetujui. Selisih sudah dicatat ke ledger stok.
        </div>
      )}
      {query.submitted && (
        <div className="form-success" role="status">
          Hasil hitung dikirim untuk ditinjau. Pergerakan stok akan tetap
          ditahan sampai disetujui atau dibatalkan.
        </div>
      )}
      {query.saved && (
        <div className="form-success" role="status">
          Hasil hitung berhasil disimpan.
        </div>
      )}
      {query.error && (
        <div className="form-error form-error-wide" role="alert">
          {errors[query.error] ?? "Sesi opname tidak dapat diproses."}
        </div>
      )}

      <div className="order-summary-grid">
        <article className="panel order-summary">
          <span>Status opname</span>
          <strong>
            <span className={`status-pill ${count.status}`}>
              {statuses[count.status] ?? count.status}
            </span>
          </strong>
        </article>
        <article className="panel order-summary">
          <span>SKU yang dihitung</span>
          <strong>
            {items.filter((item) => item.counted !== null).length}/{items.length}
          </strong>
        </article>
        <article className="panel order-summary">
          <span>SKU dengan selisih</span>
          <strong>{varianceItems}</strong>
        </article>
      </div>

      {count.status === "counting" && (
        <div className="inventory-note">
          <LockKeyhole size={16} />
          <span>
            Pergerakan stok masuk/keluar dan transfer di lokasi ini ditahan
            sampai sesi selesai. Masukkan jumlah fisik, termasuk nol.
          </span>
        </div>
      )}

      <section className="panel table-panel">
        <div className="table-toolbar">
          <div>
            <h2>Daftar hitung</h2>
            <p>
              Saldo sistem adalah snapshot saat sesi dimulai; selisih hanya
              diproses setelah persetujuan.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>SKU / barcode</th>
                <th>Produk / varian</th>
                <th>Saldo sistem</th>
                <th>Jumlah fisik</th>
                <th>Selisih</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const delta =
                  item.counted === null
                    ? null
                    : stockCountDifference(item.expected, item.counted);
                const deltaText =
                  delta === null
                    ? "Belum dihitung"
                    : `${delta > 0 ? "+" : ""}${quantity((delta / 1000).toString())} ${item.unit}`;
                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.sku}</strong>
                      <small>{item.barcode ?? "Barcode belum diatur"}</small>
                    </td>
                    <td>
                      {item.productName} · {item.variantName}
                    </td>
                    <td>
                      {quantity(item.expected)} {item.unit}
                    </td>
                    <td>
                      {canCount ? (
                        <form
                          className="inline-adjust-form"
                          action={recordStockCountItemAction}
                        >
                          <input
                            type="hidden"
                            name="stockCountId"
                            value={count.id}
                          />
                          <input type="hidden" name="itemId" value={item.id} />
                          <input
                            name="quantity"
                            type="number"
                            min="0"
                            step="0.001"
                            required
                            defaultValue={item.counted ?? ""}
                            aria-label={`Jumlah fisik ${item.sku}`}
                          />
                          <button
                            className="icon-button adjust-submit"
                            type="submit"
                            aria-label={`Simpan jumlah ${item.sku}`}
                          >
                            <CheckCircle2 size={15} />
                          </button>
                        </form>
                      ) : item.counted === null ? (
                        "—"
                      ) : (
                        `${quantity(item.counted)} ${item.unit}`
                      )}
                    </td>
                    <td>{deltaText}</td>
                  </tr>
                );
              })}
              {!items.length && (
                <tr>
                  <td className="table-empty" colSpan={5}>
                    <ClipboardCheck size={20} /> Tidak ada SKU pada sesi ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {(canCount || canApprove || canCancel) && (
        <section className="panel order-step">
          <span className="step-icon violet">
            <ClipboardCheck size={18} />
          </span>
          <div className="step-copy">
            <h2>
              {canApprove
                ? "Tinjau dan setujui"
                : count.status === "counting"
                  ? "Kirim hasil hitung"
                  : "Tindakan sesi"}
            </h2>
            <p>
              {canApprove
                ? "Setelah disetujui, saldo akan disesuaikan melalui ledger stok."
                : count.status === "counting"
                  ? "Simpan semua jumlah fisik sebelum mengajukan persetujuan."
                  : "Sesi yang dibatalkan tidak mengubah saldo stok."}
            </p>
          </div>
          {canCount && (
            <form action={submitStockCountAction}>
              <input type="hidden" name="stockCountId" value={count.id} />
              <button
                className="primary-button"
                type="submit"
                disabled={!completeCount}
              >
                Ajukan untuk persetujuan
              </button>
            </form>
          )}
          {canApprove && (
            <form action={approveStockCountAction}>
              <input type="hidden" name="stockCountId" value={count.id} />
              <button className="primary-button" type="submit">
                Setujui & terapkan selisih
              </button>
            </form>
          )}
          {canCancel && (
            <form action={cancelStockCountAction}>
              <input type="hidden" name="stockCountId" value={count.id} />
              <button className="secondary-button" type="submit">
                Batalkan sesi
              </button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
