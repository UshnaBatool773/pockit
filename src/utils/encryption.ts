import crypto from "crypto";
import { env } from "../config/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended for GCM
const KEY = Buffer.from(env.VAULT_ENCRYPTION_KEY, "hex"); // 32 bytes

/**
 * Encrypts a plaintext string (e.g. a vault password) with AES-256-GCM.
 * Returns a single string: base64(iv):base64(authTag):base64(ciphertext)
 *
 * This is defense-in-depth on top of Supabase RLS: even a raw database
 * export, a leaked service_role key, or a misconfigured policy would only
 * ever expose ciphertext, never the plaintext secret, without also
 * possessing VAULT_ENCRYPTION_KEY (which lives only in server env vars).
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted payload");
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}
