import crypto from "crypto";

const ENCRYPTION_PREFIX = "enc:v1";
const PASSWORD_PREFIX = "scrypt";

function getBaseSecret() {
  const secret = String(process.env.APP_ENCRYPTION_KEY || process.env.SESSION_SECRET || "").trim();

  if (!secret) {
    throw new Error("Defina APP_ENCRYPTION_KEY ou SESSION_SECRET para proteger os dados sensiveis.");
  }

  return secret;
}

function getDerivedKey() {
  return crypto.createHash("sha256").update(getBaseSecret()).digest();
}

function toEncryptedPayload(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getDerivedKey(), iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function fromEncryptedPayload(payload) {
  const parts = String(payload || "").split(":");
  const prefix = parts.slice(0, 2).join(":");
  const [iv, tag, data] = parts.slice(2);

  if (prefix !== ENCRYPTION_PREFIX || !iv || !tag || !data) {
    throw new Error("Payload criptografado invalido.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getDerivedKey(),
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64")),
    decipher.final()
  ]);
}

export function isEncryptedValue(value) {
  if (value == null) {
    return false;
  }

  const text = Buffer.isBuffer(value) ? value.toString("utf-8") : String(value);
  return text.startsWith(`${ENCRYPTION_PREFIX}:`);
}

export function encryptSecretText(value) {
  const normalized = String(value || "").trim();
  return normalized ? toEncryptedPayload(Buffer.from(normalized, "utf-8")) : null;
}

export function decryptSecretText(value) {
  if (value == null) {
    return null;
  }

  if (!isEncryptedValue(value)) {
    const normalized = String(value || "").trim();
    return normalized || null;
  }

  const decrypted = fromEncryptedPayload(Buffer.isBuffer(value) ? value.toString("utf-8") : value);
  return decrypted.toString("utf-8");
}

export function encryptSecretBuffer(value) {
  if (!value) {
    return null;
  }

  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.from(toEncryptedPayload(buffer), "utf-8");
}

export function decryptSecretBuffer(value) {
  if (!value) {
    return null;
  }

  if (!isEncryptedValue(value)) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  }

  const payload = Buffer.isBuffer(value) ? value.toString("utf-8") : String(value);
  return fromEncryptedPayload(payload);
}

export function hashUserPassword(password) {
  const normalized = String(password || "");
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(normalized, salt, 64).toString("hex");
  return `${PASSWORD_PREFIX}$${salt}$${hash}`;
}

export function verifyUserPassword(password, storedHash) {
  const normalizedPassword = String(password || "");
  const normalizedHash = String(storedHash || "").trim();

  if (!normalizedHash) {
    return { valid: false, needsRehash: false };
  }

  if (normalizedHash.startsWith(`${PASSWORD_PREFIX}$`)) {
    const [, salt, digest] = normalizedHash.split("$");

    if (!salt || !digest) {
      return { valid: false, needsRehash: false };
    }

    const computed = crypto.scryptSync(normalizedPassword, salt, 64).toString("hex");

    if (computed.length !== digest.length) {
      return { valid: false, needsRehash: false };
    }

    const valid = crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(digest));
    return { valid, needsRehash: false };
  }

  const legacyHash = crypto.createHash("sha256").update(normalizedPassword).digest("hex");

  if (legacyHash.length !== normalizedHash.length) {
    return { valid: false, needsRehash: false };
  }

  const valid = crypto.timingSafeEqual(Buffer.from(legacyHash), Buffer.from(normalizedHash));
  return { valid, needsRehash: valid };
}
