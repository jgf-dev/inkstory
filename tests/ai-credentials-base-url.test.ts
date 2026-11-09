import { describe, expect, it } from "vite-plus/test";
import { assertSafeBaseUrl, CredentialError } from "../src/lib/ai/credentials/service";

describe("assertSafeBaseUrl (STO-1159)", () => {
  it.each([
    "https://openrouter.ai/api/v1",
    "https://api.openai.com/v1",
    "http://example.com:8080/v1",
  ])("allows public http(s) host %s for hosted providers", (url) => {
    expect(() => assertSafeBaseUrl("openai", url)).not.toThrow();
  });

  it.each([
    "http://169.254.169.254/latest/meta-data",
    "http://127.0.0.1:11434",
    "http://localhost:3000",
    "http://api.localhost",
    "http://10.0.0.5/v1",
    "http://172.20.1.1/v1",
    "http://192.168.1.10/v1",
    "http://100.64.0.1/v1",
    "http://0.0.0.0/v1",
    "http://[::1]/v1",
    "http://[fe80::1]/v1",
    "http://[fd00::1]/v1",
    "http://[::ffff:169.254.169.254]/v1",
    "http://metadata.google.internal/v1",
    "http://2130706433/v1",
  ])("rejects private/loopback/link-local host %s for hosted providers", (url) => {
    expect(() => assertSafeBaseUrl("openrouter", url)).toThrow(CredentialError);
  });

  it.each(["ftp://example.com", "file:///etc/passwd", "not a url", "https://user:pw@example.com"])(
    "rejects %s",
    (url) => {
      expect(() => assertSafeBaseUrl("anthropic", url)).toThrow(CredentialError);
    },
  );

  it("allows loopback for local providers", () => {
    expect(() => assertSafeBaseUrl("ollama", "http://127.0.0.1:11434")).not.toThrow();
    expect(() => assertSafeBaseUrl("lmstudio", "http://localhost:1234/v1")).not.toThrow();
  });

  it("still rejects non-http schemes for local providers", () => {
    expect(() => assertSafeBaseUrl("ollama", "file:///etc/passwd")).toThrow(CredentialError);
  });
});
