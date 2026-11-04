import {
  ArrowDownToLine,
  ClipboardList,
  Boxes,
  ClipboardCheck,
  Clock3,
  Package,
  ReceiptText,
  ScanLine,
  ShoppingBag,
  Users,
} from "lucide-react";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/login/actions";
import { getSession } from "@/lib/auth";

const links = [
  { label: "Ringkasan", href: "/", icon: Boxes },
  { label: "Produk & varian", href: "/products", icon: Package },
  { label: "Persediaan", href: "/inventory", icon: ScanLine },
  { label: "Stock opname", href: "/stock-counts", icon: ClipboardCheck, countRolesOnly: true },
  { label: "Penerimaan", href: "/receiving", icon: ArrowDownToLine },
  { label: "Purchase order", href: "/purchasing", icon: ClipboardList },
  { label: "Pesanan", href: "/orders", icon: ShoppingBag },
  { label: "COD & tagihan", href: "/billing", icon: ReceiptText },
  { label: "QC & pengiriman", href: "/orders", icon: ClipboardCheck },
  { label: "Pengguna", href: "/users", icon: Users, adminOnly: true },
];

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role === "reseller") redirect("/portal");

  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Cekkuy, halaman ringkasan">
          <span className="brand-mark"><Boxes size={21} strokeWidth={2.4} /></span>
          <span className="brand-name">cekkuy<span>.</span></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <div className="warehouse-switcher">
          <span className="warehouse-avatar">G</span>
          <span className="warehouse-info"><strong>Gudang utama</strong><small>Lokasi aktif</small></span>
          <span className="switcher-dot" />
        </div>
        <div className="nav-heading">MENU UTAMA</div>
        <nav className="main-nav" aria-label="Menu utama">
          {links.filter((link) =>
            (!("adminOnly" in link) || user.role === "admin") &&
            (!("countRolesOnly" in link) ||
              ["admin", "warehouse_manager", "warehouse_staff"].includes(user.role)),
          ).map(({ label, href, icon: Icon }) => (
            <a className="nav-link" href={href} key={label}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="nav-heading secondary-heading">LAINNYA</div>
        <nav className="main-nav" aria-label="Menu lainnya">
          <a className="nav-link nav-link-muted" href="#modul-mvp" aria-disabled="true">
            <Clock3 size={18} strokeWidth={1.8} /><span>Laporan</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon"><Package size={18} /></div>
            <strong>Siap mulai?</strong>
            <p>Daftarkan produk dan masukkan stok awal untuk mulai mengelola gudang.</p>
            <span className="help-progress"><i /></span>
            <small>Pengaturan awal · MVP</small>
          </div>
          <div className="user-profile">
            <div className="user-avatar">{initials}</div>
            <div className="user-info"><strong>{user.name}</strong><small>{user.role.replaceAll("_", " ")}</small></div>
            <form action={logoutAction}>
              <button className="logout-button" type="submit" title="Keluar" aria-label="Keluar">↪</button>
            </form>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><i>/</i><strong>Gudang utama</strong></div>
          <div className="topbar-right">
            <span className="today-date">{new Intl.DateTimeFormat("id-ID", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            }).format(new Date())}</span>
            <span className="topbar-divider" />
            <div className="avatar-small">{initials}</div>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
