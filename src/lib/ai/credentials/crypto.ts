/**
 * AES-256-GCM envelope encryption for BYOK API keys (STO-1178).
 *
 * Master key: `BYOK_ENCRYPTION_KEY` — base64 of exactly 32 bytes.
 * Never log plaintext, ciphertext, iv, or the master key.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce recommended for GCM
const KEY_LENGTH = 32;

export class ByokCryptoError extends Error {
  constructor(
    message: string,
    public readonly code: "KEY_MISSING" | "KEY_INVALID" | "DECRYPT_FAILED",
  ) {
    super(message);
    this.name = "ByokCryptoError";
  }
}

/** Decode and validate `BYOK_ENCRYPTION_KEY` (base64 → 32 bytes). */
export function loadEncryptionKey(raw = process.env.BYOK_ENCRYPTION_KEY): Buffer {
  if (!raw || !raw.trim()) {
    throw new ByokCryptoError("BYOK_ENCRYPTION_KEY is not configured", "KEY_MISSING");
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), "base64");
  } catch {
    throw new ByokCryptoError("BYOK_ENCRYPTION_KEY must be valid base64", "KEY_INVALID");
  }
  if (key.length !== KEY_LENGTH) {
    throw new ByokCryptoError(
      `BYOK_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes`,
      "KEY_INVALID",
    );
  }
  return key;
}

export interface EncryptedPayload {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
}

/** Encrypt plaintext with AES-256-GCM. Returns ciphertext, iv, and auth tag. */
export function encryptSecret(plaintext: string, key = loadEncryptionKey()): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: new Uint8Array(encrypted),
    iv: new Uint8Array(iv),
    authTag: new Uint8Array(authTag),
  };
}

/** Decrypt an AES-256-GCM payload. Throws ByokCryptoError on auth failure. */
export function decryptSecret(payload: EncryptedPayload, key = loadEncryptionKey()): string {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv));
    decipher.setAuthTag(Buffer.from(payload.authTag));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext)),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    throw new ByokCryptoError("Failed to decrypt credential", "DECRYPT_FAILED");
  }
}

/** Last 4 characters of a key for display hints (empty → null). */
export function keyHintFrom(plaintext: string): string | null {
  const trimmed = plaintext.trim();
  if (!trimmed) return null;
  return trimmed.slice(-4);
}
