import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { Temporal } from "temporal-polyfill";
import { db } from "../src/lib/prisma";
import {
  assertNoSecretFields,
  getCredential,
  listCredentials,
  resolveProviderConfig,
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
});
