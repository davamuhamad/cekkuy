import { desc, eq } from "drizzle-orm";
import { PackageCheck, Plus, Truck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { codPayments, invoices, salesOrders } from "@/db/schema";
import { getSession } from "@/lib/auth";
import {
  cancelSalesOrderAction,
  updateDeliveryOutcomeAction,
} from "@/app/orders/actions";
import { recordInvoicePaymentAction, updateCodStatusAction } from "@/app/billing/actions";

export const dynamic = "force-dynamic";

const outcomes = [
  ["success", "Sukses diterima"],
  ["failed", "Gagal kirim"],
  ["returned", "Retur"],
  ["cancelled", "Batal"],
] as const;

export default async function ResellerPortal({
  searchParams,
}: {
  searchParams: Promise<{
    created?: string;
    updated?: string;
    cancelled?: string;
    error?: string;
  }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "reseller") redirect("/");
  const { created, updated, cancelled, error } = await searchParams;

  const orders = await db
    .select({
      id: salesOrders.id,
      trackingNumber: salesOrders.trackingNumber,
      status: salesOrders.status,
      deliveryOutcome: salesOrders.deliveryOutcome,
      handedOverAt: salesOrders.handedOverAt,
      outcomeUpdatedAt: salesOrders.outcomeUpdatedAt,
      isCod: salesOrders.isCod,
      codAmount: salesOrders.codAmount,
      createdAt: salesOrders.createdAt,
    })
    .from(salesOrders)
    .where(eq(salesOrders.resellerId, user.userId))
    .orderBy(desc(salesOrders.createdAt))
    .limit(200);
  const resellerInvoices = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      subtotal: invoices.subtotal,
      issuedAt: invoices.issuedAt,
      dueAt: invoices.dueAt,
    })
    .from(invoices)
    .where(eq(invoices.resellerId, user.userId))
    .orderBy(desc(invoices.createdAt))
    .limit(100);
  const codOrders = await db.select({
    id: codPayments.id,
    trackingNumber: salesOrders.trackingNumber,
    expected: codPayments.expectedAmount,
    received: codPayments.receivedAmount,
    status: codPayments.status,
    notes: codPayments.notes,
    handedOverAt: salesOrders.handedOverAt,
  }).from(codPayments).innerJoin(salesOrders, eq(codPayments.orderId, salesOrders.id))
    .where(eq(salesOrders.resellerId, user.userId)).orderBy(desc(salesOrders.createdAt)).limit(200);

  const now = Date.now();
  return (
    <main className="portal-page">
      <header className="portal-header">
        <Link className="brand" href="/portal"><span className="brand-mark"><PackageCheck size={20} /></span><span className="brand-name">cekkuy<span>.</span></span></Link>
        <div className="portal-user"><span>{user.name}</span><form action={async () => {
          "use server";
          const { destroySession } = await import("@/lib/auth");
          await destroySession();
          redirect("/login");
        }}><button className="secondary-button" type="submit">Keluar</button></form></div>
      </header>
      <div className="portal-content">
        <section className="welcome-row">
          <div><div className="eyebrow"><span className="live-dot" /> PORTAL RESELLER</div><h1>Halo, {user.name.split(" ")[0]}</h1><p className="welcome-caption">Unggah pesanan dan pantau status paket serta tagihanmu.</p></div>
          <Link className="primary-button" href="/portal/orders/new"><Plus size={17} /> Unggah pesanan</Link>
        </section>
        {created && <div className="form-success" role="status">Pesanan berhasil dibuat. Stok tersedia sudah direservasi.</div>}
        {updated && <div className="form-success" role="status">Status pengiriman berhasil diperbarui.</div>}
        {cancelled && <div className="form-success" role="status">Pesanan dibatalkan dan reservasi stok dilepas.</div>}
        {error && <div className="form-error" role="alert">{error === "locked" ? "Pesanan tidak dapat diperbarui atau batas 7 hari sudah lewat." : "Operasi tidak dapat diproses."}</div>}
        <section className="panel table-panel">
          <div className="table-toolbar"><div><h2>Pesanan saya</h2><p>{orders.length} paket terakhir · maksimal 200</p></div></div>
          <div className="table-scroll"><table>
            <thead><tr><th>Nomor resi</th><th>Tanggal</th><th>Status paket</th><th>COD</th><th>Hasil kirim</th></tr></thead>
            <tbody>{orders.map((order) => {
              const eligible = order.status === "handed_over" && order.handedOverAt && now <= order.handedOverAt.getTime() + 7 * 86400000;
              return <tr key={order.id}>
                <td><strong>{order.trackingNumber}</strong></td>
                <td>{new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(order.createdAt)}</td>
                <td><span className={`status-pill ${order.status}`}>{order.status.replaceAll("_", " ")}</span>{order.status === "awaiting_pick" && <form action={cancelSalesOrderAction}><input type="hidden" name="orderId" value={order.id} /><button className="text-link" type="submit">Batalkan</button></form>}</td>
                <td>{order.isCod ? `Rp ${Number(order.codAmount).toLocaleString("id-ID")}` : "—"}</td>
                <td>{eligible ? <form className="outcome-form portal-outcome" action={updateDeliveryOutcomeAction}><input type="hidden" name="orderId" value={order.id} /><select name="outcome" defaultValue={order.deliveryOutcome ?? ""} required><option value="" disabled>Pilih status</option>{outcomes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="icon-button" type="submit" aria-label="Simpan status"><Truck size={15} /></button></form> : order.deliveryOutcome ? order.deliveryOutcome : "—"}</td>
              </tr>;
            })}
            {!orders.length && <tr><td className="table-empty" colSpan={5}>Belum ada pesanan. Unggah resi pertama untuk memulai.</td></tr>}</tbody>
          </table></div>
        </section>
        <section className="panel table-panel portal-invoices">
          <div className="table-toolbar"><div><h2>Tagihan</h2><p>Ringkasan tagihan reseller</p></div></div>
          <div className="table-scroll"><table>
            <thead><tr><th>Nomor tagihan</th><th>Terbit</th><th>Jatuh tempo</th><th>Jumlah</th><th>Status</th></tr></thead>
            <tbody>{resellerInvoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.invoiceNumber}</strong></td><td>{invoice.issuedAt ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(invoice.issuedAt) : "Draft"}</td><td>{invoice.dueAt ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(invoice.dueAt) : "—"}</td><td>Rp {Number(invoice.subtotal).toLocaleString("id-ID")}</td><td><span className={`status-pill ${invoice.status}`}>{invoice.status.replaceAll("_", " ")}</span></td><td>{["issued","partially_paid","overdue"].includes(invoice.status) && <form className="payment-inline portal-payment" action={recordInvoicePaymentAction}><input type="hidden" name="invoiceId" value={invoice.id} /><input type="number" name="amount" min="0.01" step="0.01" required placeholder="Jumlah bayar" /><select name="method"><option>Transfer bank</option><option>E-wallet</option><option>Tunai</option></select><input name="reference" maxLength={200} placeholder="Bukti / referensi" /><button className="secondary-button" type="submit">Kirim pembayaran</button></form>}</td></tr>)}
              {!resellerInvoices.length && <tr><td className="table-empty" colSpan={6}>Belum ada tagihan terbit.</td></tr>}</tbody>
          </table></div>
        </section>
        <section className="panel table-panel portal-invoices">
          <div className="table-toolbar"><div><h2>Konfirmasi COD</h2><p>Catat uang COD yang diterima maksimal 7 hari setelah serah-terima.</p></div></div>
          <div className="table-scroll"><table><thead><tr><th>Nomor resi</th><th>Nominal COD</th><th>Uang diterima</th><th>Status / catatan</th></tr></thead><tbody>
            {codOrders.map((entry) => {
              const eligible = entry.status === "pending" && entry.handedOverAt && now <= entry.handedOverAt.getTime() + 7 * 86400000;
              return <tr key={entry.id}><td><strong>{entry.trackingNumber}</strong></td><td>Rp {Number(entry.expected).toLocaleString("id-ID")}</td><td>{entry.received ? `Rp ${Number(entry.received).toLocaleString("id-ID")}` : "—"}</td><td>{eligible ? <form className="cod-inline" action={updateCodStatusAction}><input type="hidden" name="codId" value={entry.id} /><input type="number" name="receivedAmount" min="0" step="0.01" required placeholder="Jumlah" /><select name="status"><option value="paid">Lunas</option><option value="discrepancy">Selisih</option><option value="no_collection">Tidak ada tagihan</option></select><input name="notes" maxLength={500} placeholder="Catatan" /><button className="secondary-button" type="submit">Simpan</button></form> : `${entry.status.replaceAll("_"," ")}${entry.notes ? ` · ${entry.notes}` : ""}`}</td></tr>;
            })}
            {!codOrders.length && <tr><td className="table-empty" colSpan={4}>Belum ada pesanan COD.</td></tr>}
          </tbody></table></div>
        </section>
      </div>
    </main>
  );
}
