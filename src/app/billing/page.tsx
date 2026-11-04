import { and, desc, eq, sql } from "drizzle-orm";
import { ReceiptText } from "lucide-react";
import { db } from "@/db";
import {
  codPayments,
  invoiceItems,
  invoices,
  salesOrders,
  users,
} from "@/db/schema";
import { getUserWarehouse, requireRoles } from "@/lib/auth";
import { generateInvoicesAction, recordInvoicePaymentAction, updateCodStatusAction } from "./actions";

export const dynamic = "force-dynamic";
const invoiceStatuses: Record<string, string> = {
  draft: "Draft",
  issued: "Terbit",
  partially_paid: "Dibayar sebagian",
  paid: "Lunas",
  overdue: "Terlambat",
  cancelled: "Dibatalkan",
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; generated?: string; payment?: string; cod?: string }>;
}) {
  const user = await requireRoles(["admin", "warehouse_manager", "online_ops", "management"]);
  const warehouseId = await getUserWarehouse(user.userId);
  const { error, generated, payment, cod } = await searchParams;
  const invoicesList = await db.select({
    id: invoices.id,
    number: invoices.invoiceNumber,
    resellerId: invoices.resellerId,
    reseller: users.name,
    subtotal: invoices.subtotal,
    status: invoices.status,
    dueAt: invoices.dueAt,
    lineCount: sql<number>`count(${invoiceItems.id})`,
    paid: sql<string>`coalesce((select sum(rp.amount) from reseller_payments rp where rp.invoice_id = ${invoices.id}), 0)`,
  }).from(invoices)
    .innerJoin(users, eq(invoices.resellerId, users.id))
    .leftJoin(invoiceItems, eq(invoices.id, invoiceItems.invoiceId))
    .groupBy(invoices.id, users.name)
    .orderBy(desc(invoices.createdAt))
    .limit(200);
  const codRows = await db.select({
    id: codPayments.id,
    trackingNumber: salesOrders.trackingNumber,
    reseller: users.name,
    expected: codPayments.expectedAmount,
    received: codPayments.receivedAmount,
    status: codPayments.status,
    notes: codPayments.notes,
    handedOverAt: salesOrders.handedOverAt,
  }).from(codPayments)
    .innerJoin(salesOrders, eq(codPayments.orderId, salesOrders.id))
    .innerJoin(users, eq(salesOrders.resellerId, users.id))
    .where(and(eq(salesOrders.warehouseId, warehouseId), eq(salesOrders.isCod, true)))
    .orderBy(desc(codPayments.createdAt))
    .limit(200);
  const canManage = ["admin", "online_ops"].includes(user.role);

  return <div className="page-content">
    <div className="page-title-row"><div><div className="eyebrow">COD · PIUTANG RESELLER</div><h1>COD & tagihan</h1><p className="welcome-caption">Konfirmasi COD dan terbitkan tagihan bulanan dari resi sukses.</p></div></div>
    {generated && <div className="form-success" role="status">{generated === "0" ? "Tidak ada resi sukses baru pada periode tersebut." : "Tagihan bulanan berhasil diterbitkan."}</div>}
    {payment && <div className="form-success" role="status">Pembayaran berhasil dicatat.</div>}
    {cod && <div className="form-success" role="status">Status COD berhasil diperbarui.</div>}
    {error && <div className="form-error" role="alert">{error === "month" ? "Periode tagihan tidak valid." : "Data pembayaran atau COD tidak valid."}</div>}

    {canManage && <section className="panel data-form invoice-generator">
      <div className="form-section-heading"><span className="qc-heading-icon"><ReceiptText size={17} /></span><div><h2>Terbitkan tagihan bulanan</h2><p>Hanya paket sukses yang statusnya diperbarui pada bulan terpilih. Paket tidak akan ditagih dua kali.</p></div></div>
      <form className="invoice-generate-form" action={generateInvoicesAction}><label>Periode<input name="month" type="month" required defaultValue={new Date().toISOString().slice(0, 7)} /></label><button className="primary-button" type="submit">Buat tagihan</button></form>
    </section>}

    <section className="panel table-panel billing-panel">
      <div className="table-toolbar"><div><h2>Tagihan reseller</h2><p>{invoicesList.length} tagihan · maksimal 200</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>Nomor</th><th>Reseller</th><th>Jumlah</th><th>Dibayar</th><th>Sisa</th><th>Jatuh tempo</th><th>Status</th>{canManage && <th>Catat pembayaran</th>}</tr></thead><tbody>
        {invoicesList.map((invoice) => {
          const balance = Number(invoice.subtotal) - Number(invoice.paid);
          return <tr key={invoice.id}>
            <td><strong>{invoice.number}</strong><small>{invoice.lineCount} paket</small></td><td>{invoice.reseller}</td>
            <td>Rp {Number(invoice.subtotal).toLocaleString("id-ID")}</td><td>Rp {Number(invoice.paid).toLocaleString("id-ID")}</td><td>Rp {balance.toLocaleString("id-ID")}</td>
            <td>{invoice.dueAt ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(invoice.dueAt) : "—"}</td>
            <td><span className={`status-pill ${invoice.status}`}>{invoiceStatuses[invoice.status]}</span></td>
            {canManage && <td>{balance > 0 ? <form className="payment-inline" action={recordInvoicePaymentAction}><input type="hidden" name="invoiceId" value={invoice.id} /><input type="number" name="amount" min="0.01" step="0.01" max={balance} defaultValue={balance.toFixed(2)} aria-label="Jumlah pembayaran" /><select name="method" aria-label="Metode pembayaran"><option>Transfer bank</option><option>Tunai</option><option>E-wallet</option></select><input name="reference" maxLength={200} placeholder="Referensi" aria-label="Nomor referensi" /><button className="secondary-button" type="submit">Catat</button></form> : "—"}</td>}
          </tr>;
        })}
        {!invoicesList.length && <tr><td className="table-empty" colSpan={canManage ? 8 : 7}>Belum ada tagihan. Terbitkan tagihan dari resi sukses.</td></tr>}
      </tbody></table></div>
    </section>

    <section className="panel table-panel billing-panel">
      <div className="table-toolbar"><div><h2>Konfirmasi uang COD</h2><p>Catat nominal yang diterima reseller maksimal 7 hari setelah serah-terima.</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>Nomor resi</th><th>Reseller</th><th>Ekspektasi</th><th>Diterima</th><th>Status / catatan</th></tr></thead><tbody>
        {codRows.map((entry) => {
          const editable = entry.status === "pending" && entry.handedOverAt && Date.now() <= entry.handedOverAt.getTime() + 7 * 86400000;
          return <tr key={entry.id}><td><strong>{entry.trackingNumber}</strong></td><td>{entry.reseller}</td><td>Rp {Number(entry.expected).toLocaleString("id-ID")}</td><td>{entry.received ? `Rp ${Number(entry.received).toLocaleString("id-ID")}` : "—"}</td><td>{editable ? <form className="cod-inline" action={updateCodStatusAction}><input type="hidden" name="codId" value={entry.id} /><input type="number" name="receivedAmount" min="0" step="0.01" required aria-label="Uang COD diterima" placeholder="Jumlah diterima" /><select name="status" defaultValue="paid"><option value="paid">Lunas</option><option value="discrepancy">Selisih</option></select><input name="notes" maxLength={500} placeholder="Catatan" aria-label="Catatan COD" /><button className="secondary-button" type="submit">Simpan</button></form> : <>{entry.status.replaceAll("_", " ")}{entry.notes ? ` · ${entry.notes}` : ""}</>}</td></tr>;
        })}
        {!codRows.length && <tr><td className="table-empty" colSpan={5}>Belum ada paket COD.</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}
