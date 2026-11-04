"use server";

import { compare } from "bcryptjs";
import { createHash } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { loginAttempts, users } from "@/db/schema";
import { createSession } from "@/lib/auth";

const loginSchema = z.object({
  email: z.email().max(254).transform((email) => email.trim().toLowerCase()),
  password: z
    .string()
    .min(1)
    .max(72)
    .refine((password) => Buffer.byteLength(password, "utf8") <= 72),
});
const timingFallbackHash = "$2b$12$m47sNeS7t.48jMDqwDKN3u7q4CvUPIOnZy8G7/HR8n605WIaA8oMC";

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/login?error=invalid");

  const requestHeaders = await headers();
  const forwardedIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedIp || requestHeaders.get("x-real-ip") || "unknown";
  const bucketKey = createHash("sha256")
    .update(`${parsed.data.email}:${ip}`)
    .digest("hex");

  const [attempt] = await db
    .select({
      attempts: loginAttempts.attempts,
      blockedUntil: loginAttempts.blockedUntil,
    })
    .from(loginAttempts)
    .where(eq(loginAttempts.bucketKey, bucketKey))
    .limit(1);

  if (attempt?.blockedUntil && attempt.blockedUntil > new Date()) {
    redirect("/login?error=throttled");
  }

  const [user] = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);

  const passwordMatches = await compare(
    parsed.data.password,
    user?.passwordHash ?? timingFallbackHash,
  );

  if (!user || !passwordMatches) {
    await db
      .delete(loginAttempts)
      .where(lt(loginAttempts.windowStartedAt, sql`now() - interval '24 hours'`));
    await db
      .insert(loginAttempts)
      .values({
        bucketKey,
        attempts: 1,
        windowStartedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: loginAttempts.bucketKey,
        set: {
          attempts: sql`CASE
            WHEN ${loginAttempts.windowStartedAt} < now() - interval '15 minutes' THEN 1
            ELSE ${loginAttempts.attempts} + 1
          END`,
          windowStartedAt: sql`CASE
            WHEN ${loginAttempts.windowStartedAt} < now() - interval '15 minutes' THEN now()
            ELSE ${loginAttempts.windowStartedAt}
          END`,
          blockedUntil: sql`CASE
            WHEN ${loginAttempts.windowStartedAt} < now() - interval '15 minutes' THEN NULL
            WHEN ${loginAttempts.attempts} + 1 >= 5 THEN now() + interval '15 minutes'
            ELSE NULL
          END`,
        },
      });

    redirect("/login?error=invalid");
  }

  await db.delete(loginAttempts).where(
    and(
      eq(loginAttempts.bucketKey, bucketKey),
      gt(loginAttempts.attempts, 0),
    ),
  );
  await createSession(user.id);
  redirect("/");
}

export async function logoutAction() {
  const { destroySession } = await import("@/lib/auth");
  await destroySession();
  redirect("/login");
}
