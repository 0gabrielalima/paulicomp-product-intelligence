import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { db, one, checkPassword } from "./db.ts";

export type User = { id: number; name: string; email: string; roles: string[] };
declare global { namespace Express { interface Request { user?: User } } }

const COOKIE = "ppi_session";
const DAYS = 14;

export async function login(email: string, password: string) {
  const u = await one(db, "SELECT * FROM users WHERE lower(email)=lower($1) AND active", [email.trim()]);
  if (!u || !checkPassword(password, u.password_hash)) return null;
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,now() + ($3 || ' days')::interval)", [token, u.id, String(DAYS)]);
  return { token, user: { id: u.id, name: u.name, email: u.email, roles: u.roles } as User };
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: DAYS * 86400_000 });
}

export async function logout(req: Request, res: Response) {
  const t = req.cookies?.[COOKIE];
  if (t) await db.query("DELETE FROM sessions WHERE token=$1", [t]);
  res.clearCookie(COOKIE);
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const t = req.cookies?.[COOKIE];
  if (t) {
    const u = await one(db, `SELECT u.id,u.name,u.email,u.roles FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token=$1 AND s.expires_at>now() AND u.active`, [t]);
    if (u) req.user = u as User;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Sessão expirada. Entre novamente." });
  next();
}

/** Libera se o usuario tiver QUALQUER um dos perfis (admin sempre passa). */
export const requireRole = (...roles: string[]) => (req: Request, res: Response, next: NextFunction) => {
  const r = req.user?.roles || [];
  if (r.includes("admin") || roles.some((x) => r.includes(x))) return next();
  res.status(403).json({ error: `Permissão insuficiente (requer: ${roles.join(" ou ")}).` });
};

export const can = (u: User | undefined, ...roles: string[]) => !!u && (u.roles.includes("admin") || roles.some((r) => u.roles.includes(r)));
