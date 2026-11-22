import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const resolve4 = vi.fn();
const resolve6 = vi.fn();
vi.mock("node:dns", () => ({ promises: { resolve4, resolve6 } }));

const { assertSafeBaseUrlResolved, setHostResolver, CredentialError } =
  await import("../src/lib/ai/credentials/service");
const { defaultHostResolver } = await import("../src/lib/ai/credentials/host-resolver");

function dnsError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("assertSafeBaseUrlResolved (STO-1159 SSRF via DNS)", () => {
  afterEach(() => {
    setHostResolver();
    resolve4.mockReset();
    resolve6.mockReset();
  });

  it("allows a hostname whose addresses are all public", async () => {
    const resolver = vi.fn(async () => ["104.18.2.115", "2606:4700::6812:273"]);
    await expect(
      assertSafeBaseUrlResolved("openai", "https://api.example.com/v1", resolver),
    ).resolves.toBeUndefined();
    expect(resolver).toHaveBeenCalledWith("api.example.com");
  });

  it.each([
    ["169.254.169.254"],
    ["10.0.0.5"],
    ["127.0.0.1"],
    ["192.168.1.10"],
    ["::1"],
    ["fe80::1"],
    ["fd00::1"],
    ["::ffff:169.254.169.254"],
  ])("rejects a hostname that resolves to %s", async (address) => {
    const resolver = async () => ["104.18.2.115", address];
    await expect(
      assertSafeBaseUrlResolved("openrouter", "http://rebind.example/v1", resolver),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
  });

  it("fails closed when the host does not resolve or the lookup errors", async () => {
    await expect(
      assertSafeBaseUrlResolved("anthropic", "https://nx.example", async () => []),
    ).rejects.toBeInstanceOf(CredentialError);
    await expect(
      assertSafeBaseUrlResolved("anthropic", "https://nx.example", async () => {
        throw new Error("SERVFAIL");
      }),
    ).rejects.toThrow("baseUrl host could not be resolved");
  });

  it("still applies the literal checks before resolving", async () => {
    const resolver = vi.fn(async () => ["104.18.2.115"]);
    await expect(
      assertSafeBaseUrlResolved("openai", "http://169.254.169.254/latest", resolver),
    ).rejects.toBeInstanceOf(CredentialError);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("skips DNS for public IP literals and loopback-only local providers", async () => {
    const resolver = vi.fn(async () => ["127.0.0.1"]);
    await assertSafeBaseUrlResolved("openai", "http://8.8.8.8/v1", resolver);
    await assertSafeBaseUrlResolved("openai", "http://[2606:4700::1111]/v1", resolver);
    await assertSafeBaseUrlResolved("ollama", "http://localhost:11434", resolver);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("uses the resolver installed with setHostResolver by default", async () => {
    setHostResolver(async () => ["169.254.169.254"]);
    await expect(
      assertSafeBaseUrlResolved("openai", "https://metadata-alias.example"),
    ).rejects.toBeInstanceOf(CredentialError);
    setHostResolver(async () => ["93.184.215.14"]);
    await expect(
      assertSafeBaseUrlResolved("openai", "https://metadata-alias.example"),
    ).resolves.toBeUndefined();
  });
});

describe("defaultHostResolver", () => {
  afterEach(() => {
    resolve4.mockReset();
    resolve6.mockReset();
  });

  it("returns A and AAAA records together", async () => {
    resolve4.mockResolvedValueOnce(["1.2.3.4"]);
    resolve6.mockResolvedValueOnce(["2001:4860::1"]);
    await expect(defaultHostResolver("example.com")).resolves.toEqual(["1.2.3.4", "2001:4860::1"]);
  });

  it("treats a family with no records as empty", async () => {
    resolve4.mockResolvedValueOnce(["1.2.3.4"]);
    resolve6.mockRejectedValueOnce(dnsError("ENODATA"));
    await expect(defaultHostResolver("example.com")).resolves.toEqual(["1.2.3.4"]);

    resolve4.mockRejectedValueOnce(dnsError("ENOTFOUND"));
    resolve6.mockRejectedValueOnce(dnsError("ENOTFOUND"));
    await expect(defaultHostResolver("nx.example")).resolves.toEqual([]);
  });

  it("rethrows other DNS failures so callers fail closed", async () => {
    resolve4.mockRejectedValueOnce(dnsError("ETIMEOUT"));
    resolve6.mockResolvedValueOnce([]);
    await expect(defaultHostResolver("slow.example")).rejects.toThrow("ETIMEOUT");

    resolve4.mockRejectedValueOnce(new Error("boom"));
    resolve6.mockResolvedValueOnce([]);
    await expect(defaultHostResolver("weird.example")).rejects.toThrow("boom");
  });
});
