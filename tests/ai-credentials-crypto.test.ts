import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  ByokCryptoError,
  decryptSecret,
  encryptSecret,
  keyHintFrom,
  loadEncryptionKey,
} from "../src/lib/ai/credentials/crypto";

const TEST_KEY_B64 = Buffer.alloc(32, 7).toString("base64");

describe("BYOK crypto (STO-1178)", () => {
  const prev = process.env.BYOK_ENCRYPTION_KEY;

  afterEach(() => {
    if (prev === undefined) delete process.env.BYOK_ENCRYPTION_KEY;
    else process.env.BYOK_ENCRYPTION_KEY = prev;
  });

  it("encrypt → decrypt roundtrip", () => {
    process.env.BYOK_ENCRYPTION_KEY = TEST_KEY_B64;
    const plaintext = "sk-or-v1-test-secret-key-abcdef";
    const enc = encryptSecret(plaintext);
    expect(enc.ciphertext.byteLength).toBeGreaterThan(0);
    expect(enc.iv.byteLength).toBe(12);
    expect(enc.authTag.byteLength).toBe(16);
    // Ciphertext must not equal plaintext bytes
    expect(Buffer.from(enc.ciphertext).toString("utf8")).not.toContain("sk-or-v1");
    const out = decryptSecret(enc);
    expect(out).toBe(plaintext);
  });

  it("roundtrip works with an explicit key argument (no env)", () => {
    const key = Buffer.alloc(32, 9);
    const enc = encryptSecret("hello-world-key", key);
    expect(decryptSecret(enc, key)).toBe("hello-world-key");
  });

  it("rejects tampered ciphertext", () => {
    process.env.BYOK_ENCRYPTION_KEY = TEST_KEY_B64;
    const enc = encryptSecret("sk-test-1234");
    const tampered = {
      ...enc,
      ciphertext: Uint8Array.from(enc.ciphertext.map((b, i) => (i === 0 ? b ^ 0xff : b))),
    };
    expect(() => decryptSecret(tampered)).toThrow(ByokCryptoError);
  });

  it("loadEncryptionKey validates length and presence", () => {
    delete process.env.BYOK_ENCRYPTION_KEY;
    expect(() => loadEncryptionKey()).toThrow(ByokCryptoError);
    expect(() => loadEncryptionKey(Buffer.alloc(16).toString("base64"))).toThrow(ByokCryptoError);
    expect(loadEncryptionKey(TEST_KEY_B64)).toHaveLength(32);
  });

  it("keyHintFrom returns last 4 chars", () => {
    expect(keyHintFrom("sk-abcdefgh")).toBe("efgh");
    expect(keyHintFrom("  ab  ")).toBe("ab");
    expect(keyHintFrom("")).toBeNull();
  });
});
