import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { Temporal } from "temporal-polyfill";
import { db } from "../src/lib/prisma";
import {
  assertNoSecretFields,
  getCredential,
  listCredentials,
  patchCredential,
  resolveProviderConfig,
  setHostResolver,
  softDeleteCredential,
  upsertCredential,
  CredentialError,
  SECRET_FIELD_NAMES,
} from "../src/lib/ai/credentials";

const TEST_KEY_B64 = Buffer.alloc(32, 11).toString("base64");

describe("BYOK credentials service (STO-1178)", { timeout: 20_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = `test-byok-user-${runId}`;
  const prevKey = process.env.BYOK_ENCRYPTION_KEY;

  beforeAll(async () => {
    process.env.BYOK_ENCRYPTION_KEY = TEST_KEY_B64;
    // Keep DNS hermetic: every hosted baseUrl host "resolves" to a public IP.
    setHostResolver(async () => ["93.184.215.14"]);
    const now = Temporal.Now.plainDateTimeISO();
    await db.orm.public.User.upsert({
      create: { id: userId, email: `byok-${runId}@inkstory.local`, updatedAt: now },
      update: { updatedAt: now },
    });
  });

  afterEach(async () => {
    // Soft-clean credentials for this user between tests
    const rows = await db.orm.public.UserProviderCredential.where((c) =>
      c.ownerId.eq(userId),
    ).all();
    for (const row of rows) {
      await db.orm.public.UserProviderCredential.where({ id: row.id }).delete();
    }
  });

  afterAll(async () => {
    setHostResolver();
    if (prevKey === undefined) delete process.env.BYOK_ENCRYPTION_KEY;
    else process.env.BYOK_ENCRYPTION_KEY = prevKey;
    const rows = await db.orm.public.UserProviderCredential.where((c) =>
      c.ownerId.eq(userId),
    ).all();
    for (const row of rows) {
      await db.orm.public.UserProviderCredential.where({ id: row.id }).delete();
    }
    await db.orm.public.User.where({ id: userId }).delete();
  });

  it("upsert encrypts and list/get DTOs expose no secret fields", async () => {
    const apiKey = "sk-or-v1-super-secret-key-xyz9";
    const created = await upsertCredential(userId, {
      provider: "OPENROUTER",
      label: "default",
      apiKey,
    });

    expect(created.keyHint).toBe("xyz9");
    expect(created.hasKey).toBe(true);
    expect(created.provider).toBe("OPENROUTER");
    for (const field of SECRET_FIELD_NAMES) {
      expect(Object.keys(created)).not.toContain(field);
    }
    assertNoSecretFields(created);

    const listed = await listCredentials(userId);
    expect(listed).toHaveLength(1);
    assertNoSecretFields(listed);
    expect(JSON.stringify(listed)).not.toContain(apiKey);
    expect(JSON.stringify(listed)).not.toContain("ciphertext");

    const got = await getCredential(userId, created.id);
    assertNoSecretFields(got);
    expect(got.keyHint).toBe("xyz9");

    // Raw row still has ciphertext server-side
    const raw = await db.orm.public.UserProviderCredential.where({ id: created.id }).first();
    expect(raw?.ciphertext).toBeTruthy();
    expect(raw?.iv).toBeTruthy();
    expect(raw?.authTag).toBeTruthy();
  });

  it("resolveProviderConfig returns usable config; soft-deleted not resolvable", async () => {
    const apiKey = "sk-openai-test-key-abcd";
    const created = await upsertCredential(userId, {
      provider: "OPENAI",
      apiKey,
    });

    const config = await resolveProviderConfig(userId, created.id);
    expect(config.provider).toBe("openai");
    if (config.provider === "openai") {
      expect(config.apiKey).toBe(apiKey);
    }

    await softDeleteCredential(userId, created.id);

    await expect(resolveProviderConfig(userId, created.id)).rejects.toBeInstanceOf(CredentialError);
    await expect(getCredential(userId, created.id)).rejects.toBeInstanceOf(CredentialError);

    const listed = await listCredentials(userId);
    expect(listed.find((c) => c.id === created.id)).toBeUndefined();
  });

  it("upsert updating without apiKey preserves existing key and hint", async () => {
    const originalKey = "sk-ant-test-key-original-1234";
    const created = await upsertCredential(userId, {
      provider: "ANTHROPIC",
      label: "main",
      apiKey: originalKey,
      baseUrl: "https://api.anthropic.com",
    });
    expect(created.keyHint).toBe("1234");
    expect(created.hasKey).toBe(true);

    // Update only baseUrl and defaultModel, omitting apiKey
    const updated = await upsertCredential(userId, {
      provider: "ANTHROPIC",
      label: "main",
      baseUrl: "https://proxy.anthropic.com",
      defaultModel: "claude-3-opus",
      defaultTemp: 0.7,
    });

    expect(updated.id).toBe(created.id);
    expect(updated.keyHint).toBe("1234");
    expect(updated.hasKey).toBe(true);
    expect(updated.baseUrl).toBe("https://proxy.anthropic.com");

    const resolved = await resolveProviderConfig(userId, updated.id);
    expect(resolved.provider).toBe("anthropic");
    if (resolved.provider === "anthropic") {
      expect(resolved.apiKey).toBe(originalKey);
      expect(resolved.baseUrl).toBe("https://proxy.anthropic.com");
    }
  });

  it("rejects baseUrl hosts that resolve to internal addresses (save and use time)", async () => {
    setHostResolver(async (host) =>
      host === "rebind.example" ? ["169.254.169.254"] : ["93.184.215.14"],
    );
    try {
      await expect(
        upsertCredential(userId, {
          provider: "OPENAI",
          label: "rebind",
          apiKey: "sk-test-rebind-0001",
          baseUrl: "https://rebind.example/v1",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

      const created = await upsertCredential(userId, {
        provider: "OPENAI",
        label: "rebind",
        apiKey: "sk-test-rebind-0001",
        baseUrl: "https://public.example/v1",
      });
      await expect(
        patchCredential(userId, created.id, { baseUrl: "https://rebind.example/v1" }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

      // DNS for a stored host can change after save: re-checked before decrypting.
      setHostResolver(async () => ["10.0.0.7"]);
      await expect(resolveProviderConfig(userId, created.id)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    } finally {
      setHostResolver(async () => ["93.184.215.14"]);
    }
  });

  it("allows keyless local providers with baseUrl", async () => {
    const created = await upsertCredential(userId, {
      provider: "OLLAMA",
      baseUrl: "http://127.0.0.1:11434/v1",
    });
    expect(created.hasKey).toBe(false);
    expect(created.baseUrl).toBe("http://127.0.0.1:11434/v1");
    assertNoSecretFields(created);

    const config = await resolveProviderConfig(userId, created.id);
    expect(config.provider).toBe("ollama");
  });

  it("rejects cloud providers without an apiKey", async () => {
    await expect(upsertCredential(userId, { provider: "ANTHROPIC" })).rejects.toBeInstanceOf(
      CredentialError,
    );
  });

  it("upsert update omits key fields when apiKey is not sent", async () => {
    const created = await upsertCredential(userId, {
      provider: "OLLAMA",
      label: "local",
      apiKey: "ollama-optional-key-zz99",
      baseUrl: "http://127.0.0.1:11434/v1",
    });
    expect(created.hasKey).toBe(true);
    expect(created.keyHint).toBe("zz99");

    const updated = await upsertCredential(userId, {
      provider: "OLLAMA",
      label: "local",
      baseUrl: "http://127.0.0.1:11435/v1",
    });
    expect(updated.id).toBe(created.id);
    expect(updated.baseUrl).toBe("http://127.0.0.1:11435/v1");
    expect(updated.hasKey).toBe(true);
    expect(updated.keyHint).toBe("zz99");

    const raw = await db.orm.public.UserProviderCredential.where({ id: created.id }).first();
    expect(raw?.ciphertext).toBeTruthy();
    expect(raw?.iv).toBeTruthy();
    expect(raw?.authTag).toBeTruthy();
  });

  it("upsert serializes concurrent creates for the same label", async () => {
    const results = await Promise.all([
      upsertCredential(userId, {
        provider: "OPENROUTER",
        label: "race",
        apiKey: "sk-or-race-aaaa",
      }),
      upsertCredential(userId, {
        provider: "OPENROUTER",
        label: "race",
        apiKey: "sk-or-race-bbbb",
      }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    const active = await db.orm.public.UserProviderCredential.where((c) => c.ownerId.eq(userId))
      .where((c) => c.provider.eq("OPENROUTER"))
      .where((c) => c.label.eq("race"))
      .where((c) => c.deletedAt.isNull())
      .all();
    expect(active).toHaveLength(1);
  });

  it("validates provider name and label length on upsert", async () => {
    // @ts-expect-error invalid provider
    await expect(upsertCredential(userId, { provider: "INVALID_PROVIDER" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    });

    await expect(
      upsertCredential(userId, {
        provider: "OPENAI",
        apiKey: "sk-test",
        label: "a".repeat(65),
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    });
  });

  it("patchCredential updates fields and handles errors", async () => {
    const otherUserId = `other-user-${runId}`;
    const cred = await upsertCredential(userId, {
      provider: "OPENROUTER",
      label: "work",
      apiKey: "sk-or-v1-initial-key-aaaa",
    });

    // 404 for wrong owner or non-existent
    await expect(
      patchCredential(otherUserId, cred.id, { label: "new-label" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(
      patchCredential(userId, crypto.randomUUID(), { label: "new-label" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    // 400 for label > 64
    await expect(patchCredential(userId, cred.id, { label: "x".repeat(65) })).rejects.toMatchObject(
      { code: "VALIDATION_FAILED", status: 400 },
    );

    // 400 for clearing apiKey on cloud provider
    await expect(patchCredential(userId, cred.id, { apiKey: "" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    });

    // Conflict when renaming label to existing active credential
    const second = await upsertCredential(userId, {
      provider: "OPENROUTER",
      label: "personal",
      apiKey: "sk-or-v1-second-key-bbbb",
    });
    await expect(patchCredential(userId, second.id, { label: "work" })).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });

    // Successful patch updating label, model, and key
    const patched = await patchCredential(userId, cred.id, {
      label: "work-updated",
      apiKey: "sk-or-v1-new-key-cccc",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "anthropic/claude-3-opus",
      defaultTemp: 0.5,
    });
    expect(patched.label).toBe("work-updated");
    expect(patched.keyHint).toBe("cccc");
    expect(patched.baseUrl).toBe("https://openrouter.ai/api/v1");

    // Local provider can clear key
    const localCred = await upsertCredential(userId, {
      provider: "LMSTUDIO",
      label: "local-dev",
      apiKey: "optional-token-dddd",
    });
    expect(localCred.hasKey).toBe(true);
    const cleared = await patchCredential(userId, localCred.id, { apiKey: "" });
    expect(cleared.hasKey).toBe(false);
    expect(cleared.keyHint).toBeNull();
  });

  it("getCredential and softDeleteCredential handle 404 errors", async () => {
    const cred = await upsertCredential(userId, {
      provider: "LMSTUDIO",
      label: "lm-test",
    });

    await expect(getCredential("wrong-owner", cred.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    await expect(getCredential(userId, crypto.randomUUID())).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });

    await expect(softDeleteCredential("wrong-owner", cred.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    await expect(softDeleteCredential(userId, crypto.randomUUID())).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("resolveProviderConfig supports all provider types and rejects missing keys", async () => {
    const orCred = await upsertCredential(userId, {
      provider: "OPENROUTER",
      apiKey: "sk-or-test-key-1111",
    });
    const orConfig = await resolveProviderConfig(userId, orCred.id);
    expect(orConfig.provider).toBe("openrouter");

    const lmCred = await upsertCredential(userId, {
      provider: "LMSTUDIO",
      baseUrl: "http://localhost:1234/v1",
    });
    const lmConfig = await resolveProviderConfig(userId, lmCred.id);
    expect(lmConfig.provider).toBe("lmstudio");

    // createProviderFromCredential works
    const { createProviderFromCredential } = await import("../src/lib/ai/credentials");
    const provider = await createProviderFromCredential(userId, orCred.id);
    expect(provider).toBeDefined();

    // 404 on wrong owner or non-existent
    await expect(resolveProviderConfig("wrong-owner", orCred.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("assertNoSecretFields throws when secret fields are present", () => {
    expect(() => assertNoSecretFields({ ciphertext: "leaked" })).toThrow(/Secret field/);
    expect(() => assertNoSecretFields({ nested: { apiKey: "leaked" } })).toThrow(/Secret field/);
    expect(() => assertNoSecretFields([{ safe: 1 }, { key: "leaked" }])).toThrow(/Secret field/);
    expect(() => assertNoSecretFields(null)).not.toThrow();
    expect(() => assertNoSecretFields("string")).not.toThrow();
  });

  it("handleCredentialApiError formats responses properly", async () => {
    const { handleCredentialApiError } = await import("../src/lib/ai/credentials");
    const { ByokCryptoError } = await import("../src/lib/ai/credentials/crypto");

    const syntaxRes = handleCredentialApiError(new SyntaxError("Bad JSON"));
    expect(syntaxRes.status).toBe(400);

    const credRes = handleCredentialApiError(new CredentialError("Not found", "NOT_FOUND", 404));
    expect(credRes.status).toBe(404);

    const cryptoKeyMissing = handleCredentialApiError(
      new ByokCryptoError("missing", "KEY_MISSING"),
    );
    expect(cryptoKeyMissing.status).toBe(503);

    const cryptoDecryptFailed = handleCredentialApiError(
      new ByokCryptoError("decrypt", "DECRYPT_FAILED"),
    );
    expect(cryptoDecryptFailed.status).toBe(500);

    const unknownRes = handleCredentialApiError(new Error("unexpected"));
    expect(unknownRes.status).toBe(500);
  });
});
