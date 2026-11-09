import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { Temporal } from "temporal-polyfill";
import { GET as listPutGet, PUT } from "../src/app/api/ai/credentials/route";
import { DELETE, GET as getOne, PATCH } from "../src/app/api/ai/credentials/[id]/route";
import { assertNoSecretFields, SECRET_FIELD_NAMES } from "../src/lib/ai/credentials";
import { db } from "../src/lib/prisma";

const TEST_KEY_B64 = Buffer.alloc(32, 13).toString("base64");

const mockGetUser = vi.fn();
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: () => mockGetUser(),
    },
  }),
}));

describe("BYOK credentials API (STO-1178)", { timeout: 20_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = `test-byok-api-${runId}`;
  const prevKey = process.env.BYOK_ENCRYPTION_KEY;

  beforeAll(async () => {
    process.env.BYOK_ENCRYPTION_KEY = TEST_KEY_B64;
    const now = Temporal.Now.plainDateTimeISO();
    await db.orm.public.User.upsert({
      create: { id: userId, email: `byok-api-${runId}@inkstory.local`, updatedAt: now },
      update: { updatedAt: now },
    });
  });

  afterEach(async () => {
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

  it("PUT/GET/LIST responses never include secret fields", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId, email: "a@b.c" } } });

    const apiKey = "sk-ant-secret-value-qw12";
    const putRes = await PUT(
      new NextRequest("http://localhost:3000/api/ai/credentials", {
        method: "PUT",
        body: JSON.stringify({ provider: "ANTHROPIC", apiKey }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json<any>();
    assertNoSecretFields(putBody);
    expect(JSON.stringify(putBody)).not.toContain(apiKey);
    for (const field of SECRET_FIELD_NAMES) {
      expect(JSON.stringify(putBody)).not.toContain(`"${field}"`);
    }
    expect(putBody.credential.keyHint).toBe("qw12");
    expect(putBody.credential.hasKey).toBe(true);

    const listRes = await listPutGet();
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json<any>();
    assertNoSecretFields(listBody);

    const id = putBody.credential.id as string;
    const oneRes = await getOne(new NextRequest(`http://localhost:3000/api/ai/credentials/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(oneRes.status).toBe(200);
    assertNoSecretFields(await oneRes.json<any>());
  });

  it("DELETE soft-deletes; subsequent GET is 404", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId, email: "a@b.c" } } });

    const putRes = await PUT(
      new NextRequest("http://localhost:3000/api/ai/credentials", {
        method: "PUT",
        body: JSON.stringify({ provider: "OPENAI", apiKey: "sk-openai-zzzz" }),
      }),
    );
    const { credential } = await putRes.json<any>();

    const delRes = await DELETE(
      new NextRequest(`http://localhost:3000/api/ai/credentials/${credential.id}`),
      { params: Promise.resolve({ id: credential.id }) },
    );
    expect(delRes.status).toBe(200);

    const getRes = await getOne(
      new NextRequest(`http://localhost:3000/api/ai/credentials/${credential.id}`),
      { params: Promise.resolve({ id: credential.id }) },
    );
    expect(getRes.status).toBe(404);
  });

  it("PATCH can rotate the key hint", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId, email: "a@b.c" } } });

    const putRes = await PUT(
      new NextRequest("http://localhost:3000/api/ai/credentials", {
        method: "PUT",
        body: JSON.stringify({ provider: "OPENROUTER", apiKey: "sk-old-key-1111" }),
      }),
    );
    const { credential } = await putRes.json<any>();

    const patchRes = await PATCH(
      new NextRequest(`http://localhost:3000/api/ai/credentials/${credential.id}`, {
        method: "PATCH",
        body: JSON.stringify({ apiKey: "sk-new-key-2222" }),
      }),
      { params: Promise.resolve({ id: credential.id }) },
    );
    expect(patchRes.status).toBe(200);
    const body = await patchRes.json<any>();
    assertNoSecretFields(body);
    expect(body.credential.keyHint).toBe("2222");
    expect(JSON.stringify(body)).not.toContain("sk-new-key");
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await listPutGet();
    expect(res.status).toBe(401);

    const putRes = await PUT(
      new NextRequest("http://localhost:3000/api/ai/credentials", {
        method: "PUT",
        body: JSON.stringify({ provider: "OPENROUTER" }),
      }),
    );
    expect(putRes.status).toBe(401);

    const getRes = await getOne(
      new NextRequest("http://localhost:3000/api/ai/credentials/test-id"),
      { params: Promise.resolve({ id: "test-id" }) },
    );
    expect(getRes.status).toBe(401);

    const patchRes = await PATCH(
      new NextRequest("http://localhost:3000/api/ai/credentials/test-id", {
        method: "PATCH",
        body: JSON.stringify({ label: "test" }),
      }),
      { params: Promise.resolve({ id: "test-id" }) },
    );
    expect(patchRes.status).toBe(401);

    const delRes = await DELETE(
      new NextRequest("http://localhost:3000/api/ai/credentials/test-id"),
      { params: Promise.resolve({ id: "test-id" }) },
    );
    expect(delRes.status).toBe(401);
  });

  it("validates request bodies and returns 400 for bad input", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId, email: "a@b.c" } } });

    // Invalid provider
    const badProviderRes = await PUT(
      new NextRequest("http://localhost:3000/api/ai/credentials", {
        method: "PUT",
        body: JSON.stringify({ provider: "INVALID" }),
      }),
    );
    expect(badProviderRes.status).toBe(400);

    // Bad field types on PUT
    const badLabelRes = await PUT(
      new NextRequest("http://localhost:3000/api/ai/credentials", {
        method: "PUT",
        body: JSON.stringify({ provider: "OPENROUTER", label: 123 }),
      }),
    );
    expect(badLabelRes.status).toBe(400);

    const badKeyRes = await PUT(
      new NextRequest("http://localhost:3000/api/ai/credentials", {
        method: "PUT",
        body: JSON.stringify({ provider: "OPENROUTER", apiKey: 123 }),
      }),
    );
    expect(badKeyRes.status).toBe(400);

    const badBaseRes = await PUT(
      new NextRequest("http://localhost:3000/api/ai/credentials", {
        method: "PUT",
        body: JSON.stringify({ provider: "OPENROUTER", baseUrl: 123 }),
      }),
    );
    expect(badBaseRes.status).toBe(400);

    // Empty body on PATCH
    const emptyPatchRes = await PATCH(
      new NextRequest("http://localhost:3000/api/ai/credentials/test-id", {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "test-id" }) },
    );
    expect(emptyPatchRes.status).toBe(400);

    // Bad field types on PATCH
    const badPatchRes = await PATCH(
      new NextRequest("http://localhost:3000/api/ai/credentials/test-id", {
        method: "PATCH",
        body: JSON.stringify({ label: 456 }),
      }),
      { params: Promise.resolve({ id: "test-id" }) },
    );
    expect(badPatchRes.status).toBe(400);
  });
});
