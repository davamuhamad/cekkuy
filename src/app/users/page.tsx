import { desc } from "drizzle-orm";
import { UserPlus } from "lucide-react";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireRoles } from "@/lib/auth";
import { createUserAction } from "./actions";

export const dynamic = "force-dynamic";
const labels: Record<string, string> = {
  admin: "Admin",
  warehouse_manager: "Kepala gudang",
  warehouse_staff: "Staf gudang",
  qc: "Petugas QC",
  purchasing: "Purchasing",
  online_ops: "Online ops / CS",
  management: "Manajemen",
  reseller: "Reseller",
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  await requireRoles(["admin"]);
  const { error, created } = await searchParams;
  const rows = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt }).from(users).orderBy(desc(users.createdAt)).limit(200);
  return (
    <div className="page-content form-page">
      <div className="page-title-row"><div><div className="eyebrow">AKSES & RESELLER</div><h1>Pengguna</h1><p className="welcome-caption">Buat akun dengan peran dan akses gudang utama.</p></div></div>
      {created && <div className="form-success" role="status">Akun berhasil dibuat dan ditautkan ke gudang utama.</div>}
      {error && <div className="form-error" role="alert">{error === "duplicate" ? "Email sudah digunakan." : "Data tidak valid. Kata sandi minimal 12 karakter."}</div>}
      <form className="panel data-form" action={createUserAction}>
        <div className="form-section-heading"><h2><UserPlus size={16} /> Buat akun</h2><p>Kata sandi awal harus diberikan kepada pengguna melalui saluran aman.</p></div>
        <div className="form-grid">
          <label>Nama lengkap<input name="name" required minLength={2} maxLength={120} /></label>
          <label>Email<input name="email" type="email" required maxLength={254} /></label>
          <label>Kata sandi awal<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={72} /></label>
          <label>Peran<select name="role" defaultValue="reseller"><option value="reseller">Reseller</option><option value="warehouse_staff">Staf gudang</option><option value="qc">Petugas QC</option><option value="purchasing">Purchasing</option><option value="online_ops">Online ops / CS</option><option value="warehouse_manager">Kepala gudang</option><option value="management">Manajemen</option></select></label>
        </div>
        <div className="form-actions"><button className="primary-button" type="submit">Buat pengguna</button></div>
      </form>
      <section className="panel table-panel user-list">
        <div className="table-toolbar"><div><h2>Daftar pengguna</h2><p>{rows.length} akun · maksimal 200</p></div></div>
        <div className="table-scroll"><table><thead><tr><th>Nama</th><th>Email</th><th>Peran</th><th>Dibuat</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.email}</td><td>{labels[row.role]}</td><td>{new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(row.createdAt)}</td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}
