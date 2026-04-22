import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ensureSchema, query } from "@/lib/db";
import { hashUserPassword, verifyUserPassword } from "@/lib/security";

const SESSION_COOKIE = "portal_fiscal_session";
const DB_EDITOR_COOKIE = "portal_fiscal_db_editor";
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MINUTES = 30;
const LOCKOUT_MINUTES = 30;

function getSecret() {
  const secret = String(process.env.SESSION_SECRET || "").trim();

  if (!secret) {
    throw new Error("Defina SESSION_SECRET para habilitar o login.");
  }

  return secret;
}

function sign(value) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
}

function createToken(userCode) {
  const normalizedUserCode = encodeURIComponent(String(userCode || "").trim());
  return `${normalizedUserCode}.${sign(normalizedUserCode)}`;
}

function parseToken(token) {
  if (!token) return null;

  const separatorIndex = token.lastIndexOf(".");

  if (separatorIndex <= 0) {
    return null;
  }

  const encodedUserCode = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);

  if (!encodedUserCode || !signature) {
    return null;
  }

  const expected = sign(encodedUserCode);

  if (!expected || expected.length !== signature.length) {
    return null;
  }

  const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  if (!valid) {
    return null;
  }

  try {
    return decodeURIComponent(encodedUserCode);
  } catch {
    return encodedUserCode;
  }
}

async function getUserByCode(userCode) {
  await ensureSchema();

  const result = await query(
    `SELECT id, user_code, full_name, is_admin
     FROM users
     WHERE user_code = $1`,
    [String(userCode || "").trim()]
  );

  return result.rows[0] || null;
}

export async function getSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const userCode = parseToken(token);

  if (!userCode) {
    return null;
  }

  const user = await getUserByCode(userCode);

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    userCode: user.user_code,
    fullName: user.full_name,
    isAdmin: Boolean(user.is_admin)
  };
}

export async function requireAuth() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function requireAdmin() {
  const session = await requireAuth();

  if (!session.isAdmin) {
    throw new Error("Somente o administrador pode acessar esta area.");
  }

  return session;
}

export async function validateLoginCredentials(userCode, password) {
  await ensureSchema();

  const normalizedUserCode = String(userCode || "").trim();
  const result = await query(
    `SELECT id, user_code, full_name, is_admin, password_hash
     FROM users
     WHERE user_code = $1`,
    [normalizedUserCode]
  );

  const user = result.rows[0];

  if (!user) {
    return null;
  }

  const passwordCheck = verifyUserPassword(password, user.password_hash);

  if (!passwordCheck.valid) {
    return null;
  }

  if (passwordCheck.needsRehash) {
    await query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      hashUserPassword(password),
      user.id
    ]);
  }

  return {
    id: user.id,
    user_code: user.user_code,
    full_name: user.full_name,
    is_admin: user.is_admin
  };
}

export async function createSession(userCode) {
  const token = createToken(userCode);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });
}

export async function loginUser(userCode, password) {
  const user = await validateLoginCredentials(userCode, password);

  if (!user) {
    throw new Error("Usuario ou senha invalidos.");
  }

  await createSession(user.user_code);
  return user;
}

export async function createUserAccount({ userCode, fullName, password, isAdmin = false }) {
  const normalizedUserCode = String(userCode || "").trim();
  const normalizedName = String(fullName || "").trim();
  const normalizedPassword = String(password || "");

  if (!normalizedUserCode) {
    throw new Error("Informe o usuario.");
  }

  if (!normalizedName) {
    throw new Error("Informe o nome completo.");
  }

  if (!normalizedPassword) {
    throw new Error("Informe a senha.");
  }

  await ensureSchema();

  const existing = await query("SELECT 1 FROM users WHERE user_code = $1", [normalizedUserCode]);

  if (existing.rows.length > 0) {
    throw new Error("Ja existe um usuario com esse codigo.");
  }

  await query(
    `INSERT INTO users (id, user_code, full_name, password_hash, is_admin)
     VALUES (
       COALESCE((SELECT MAX(id) + 1 FROM users WHERE id > 0), 1),
       $1,
       $2,
       $3,
       $4
     )`,
    [normalizedUserCode, normalizedName, hashUserPassword(normalizedPassword), Boolean(isAdmin)]
  );
}

export async function logoutUser() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(DB_EDITOR_COOKIE);
}

export async function hasDatabaseEditorAccess() {
  const store = await cookies();
  const token = store.get(DB_EDITOR_COOKIE)?.value;
  return parseToken(token) === "scope:db-editor-root";
}

export async function grantDatabaseEditorAccess() {
  const store = await cookies();
  store.set(DB_EDITOR_COOKIE, createToken("scope:db-editor-root"), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 30
  });
}

export async function revokeDatabaseEditorAccess() {
  const store = await cookies();
  store.delete(DB_EDITOR_COOKIE);
}

function normalizeIpAddress(ipAddress) {
  return String(ipAddress || "").trim().slice(0, 120) || "unknown";
}

export function getClientIpAddress(request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const cloudflareIp = request.headers.get("cf-connecting-ip");

  return normalizeIpAddress(
    forwardedFor?.split(",")[0] ||
      realIp ||
      cloudflareIp ||
      request.ip ||
      "unknown"
  );
}

export async function getLoginLockState(ipAddress) {
  await ensureSchema();

  const normalizedIp = normalizeIpAddress(ipAddress);
  const result = await query(
    `SELECT failed_attempts, last_failed_at, locked_until
     FROM login_attempts
     WHERE ip_address = $1`,
    [normalizedIp]
  );

  const record = result.rows[0];

  if (!record?.locked_until) {
    return { locked: false };
  }

  const lockedUntil = new Date(record.locked_until);

  if (lockedUntil <= new Date()) {
    await query("DELETE FROM login_attempts WHERE ip_address = $1", [normalizedIp]);
    return { locked: false };
  }

  return {
    locked: true,
    lockedUntil
  };
}

export async function registerFailedLoginAttempt(ipAddress) {
  await ensureSchema();

  const normalizedIp = normalizeIpAddress(ipAddress);
  const result = await query(
    `SELECT failed_attempts, last_failed_at, locked_until
     FROM login_attempts
     WHERE ip_address = $1`,
    [normalizedIp]
  );
  const record = result.rows[0];
  const now = new Date();
  const lastFailedAt = record?.last_failed_at ? new Date(record.last_failed_at) : null;
  const stillInWindow =
    lastFailedAt &&
    now.getTime() - lastFailedAt.getTime() < LOGIN_WINDOW_MINUTES * 60 * 1000;
  const failedAttempts = stillInWindow ? Number(record?.failed_attempts || 0) + 1 : 1;
  const lockedUntil =
    failedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS
      ? new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000)
      : null;

  await query(
    `INSERT INTO login_attempts (ip_address, failed_attempts, last_failed_at, locked_until)
     VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
     ON CONFLICT (ip_address) DO UPDATE
     SET failed_attempts = EXCLUDED.failed_attempts,
         last_failed_at = EXCLUDED.last_failed_at,
         locked_until = EXCLUDED.locked_until`,
    [normalizedIp, failedAttempts, lockedUntil]
  );

  return {
    locked: Boolean(lockedUntil),
    remainingAttempts: Math.max(MAX_FAILED_LOGIN_ATTEMPTS - failedAttempts, 0),
    lockedUntil
  };
}

export async function clearFailedLoginAttempts(ipAddress) {
  await ensureSchema();
  await query("DELETE FROM login_attempts WHERE ip_address = $1", [normalizeIpAddress(ipAddress)]);
}
