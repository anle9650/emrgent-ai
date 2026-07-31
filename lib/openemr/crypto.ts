import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

// No "server-only" marker here: this module depends on node:crypto, which
// can't be bundled for the browser/edge, so it's already effectively
// server-only — and omitting the marker keeps it importable by the tsx unit
// runner (which can't load server-only modules). Callers that touch stored
// secrets (config.ts, the settings action) are themselves server-only.

// Symmetric encryption for the OpenEMR OAuth2 client secret at rest (the only
// sensitive field on the per-user OpenemrConnection row). aes-256-gcm gives us
// authenticated encryption, so a tampered ciphertext fails to decrypt rather
// than silently returning garbage.
//
// The key is derived from AUTH_SECRET — the same secret NextAuth uses to
// encrypt the session JWT — via scrypt with a fixed application salt. Rotating
// AUTH_SECRET therefore invalidates stored secrets (users would re-enter them),
// which matches how rotating it already invalidates existing sessions.

const KEY_SALT = "emrgent-openemr-v1";
const IV_LENGTH = 12; // 96-bit nonce, the standard/recommended size for GCM
const AUTH_TAG_LENGTH = 16;

function deriveKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET must be set to encrypt/decrypt the OpenEMR client secret"
    );
  }
  return scryptSync(secret, KEY_SALT, 32);
}

/**
 * Encrypt a plaintext secret. Returns a base64 envelope of
 * `iv || authTag || ciphertext`, safe to store in a text column. A fresh random
 * IV per call means encrypting the same value twice yields different output.
 */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Decrypt an envelope produced by `encryptSecret`. Throws if the envelope is
 * malformed or fails GCM authentication (tampering or wrong key).
 */
export function decryptSecret(envelope: string): string {
  const key = deriveKey();
  const data = Buffer.from(envelope, "base64");
  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Malformed encrypted OpenEMR client secret");
  }
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
