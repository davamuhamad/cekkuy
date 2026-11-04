import { Boxes, LockKeyhole } from "lucide-react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loginAction, logoutAction } from "./actions";

const messages: Record<string, string> = {
  invalid: "Email atau kata sandi tidak sesuai.",
  throttled: "Terlalu banyak percobaan. Coba lagi dalam 15 menit.",
  forbidden: "Akun ini belum diberi akses ke portal gudang.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session && session.role !== "reseller") redirect("/");
  const { error } = await searchParams;

  return (
    <main className="login-page">
      <section className="login-card">
        <a className="brand login-brand" href="/login">
          <span className="brand-mark"><Boxes size={21} strokeWidth={2.4} /></span>
          <span className="brand-name">cekkuy<span>.</span></span>
        </a>
        <div className="login-heading">
          <span className="login-lock"><LockKeyhole size={19} /></span>
          <h1>Selamat datang kembali</h1>
          <p>Masuk untuk mengelola stok dan aktivitas gudang.</p>
        </div>
        {session?.role === "reseller" && (
          <div className="form-error" role="status">
            Portal reseller belum tersedia. Keluar dari akun ini untuk masuk dengan akun gudang.
            <form action={logoutAction}><button className="logout-reseller" type="submit">Keluar dari akun reseller</button></form>
          </div>
        )}
        {error && <div className="form-error" role="alert">{messages[error] ?? messages.invalid}</div>}
        <form action={loginAction} className="login-form">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required maxLength={254} />
          <label htmlFor="password">Kata sandi</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={72} />
          <button className="primary-button login-submit" type="submit">Masuk ke dashboard</button>
        </form>
        <p className="login-help">Akun admin dibuat melalui perintah bootstrap. Hubungi administrator jika Anda belum memiliki akses.</p>
      </section>
      <span className="login-footer">Cekkuy · Manajemen Stok & Gudang</span>
    </main>
  );
}
