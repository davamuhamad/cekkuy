import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { authSessions, users, userWarehouses } from "@/db/schema";

const sessionCookieName = "cekkuy_session";
const sessionDurationMs = 1000 * 60 * 60 * 24 * 7;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDurationMs);

  await db
    .delete(authSessions)
    .where(and(eq(authSessions.userId, userId), lt(authSessions.expiresAt, new Date())));
  await db.insert(authSessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  if (token) {
    await db.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(token)));
  }
  cookieStore.delete(sessionCookieName);
}

export async function getSession() {
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) return null;

  const [session] = await db
    .select({
      id: authSessions.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(
      and(
        eq(authSessions.tokenHash, hashToken(token)),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return session ?? null;
}

export async function requireUser() {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

export async function requireRoles(roles: readonly string[]) {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    redirect("/?error=forbidden");
  }
  return user;
}

export async function getUserWarehouse(userId: string) {
  const [membership] = await db
    .select({ warehouseId: userWarehouses.warehouseId })
    .from(userWarehouses)
    .where(eq(userWarehouses.userId, userId))
    .limit(1);

  if (!membership) throw new Error("Akun belum ditautkan ke gudang.");
  return membership.warehouseId;
}
