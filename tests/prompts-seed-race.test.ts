import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { Temporal } from "temporal-polyfill";
import { db } from "../src/lib/prisma";
import { ensureSystemDefaultPrompts } from "../src/lib/prompts/service";

// A seed with a private id and a mode no other test resolves, so concurrent
// seeding against an empty table can be exercised without touching the
// shipped SYSTEM_DEFAULT rows other DB test files rely on (STO-1289).
const raceSeed = vi.hoisted(() => {
  const id = `sys-prompt-sto-1289-${crypto.randomUUID()}`;
  return {
    id,
    name: "STO-1289 race seed",
    description: "Concurrent seeding regression fixture.",
    mode: `sto-1289-race-${id}`,
    systemBody: "system body",
    userBody: "user body",
  };
});

vi.mock("../src/lib/prompts/defaults", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/prompts/defaults")>()),
  SYSTEM_DEFAULT_SEED: [raceSeed],
}));

describe("ensureSystemDefaultPrompts concurrency (STO-1289)", { timeout: 30_000 }, () => {
  const componentIds = [`${raceSeed.id}-system`, `${raceSeed.id}-user`];
  const linkIds = [`${raceSeed.id}-link-0`, `${raceSeed.id}-link-1`];

  afterAll(async () => {
    for (const id of linkIds) await db.orm.public.PromptComponentLink.where({ id }).delete();
    for (const id of componentIds) await db.orm.public.PromptComponent.where({ id }).delete();
    await db.orm.public.Prompt.where({ id: raceSeed.id }).delete();
  });

  it("lets concurrent callers seed an empty table without duplicate-key errors", async () => {
    await expect(
      Promise.all(Array.from({ length: 6 }, () => ensureSystemDefaultPrompts())),
    ).resolves.toHaveLength(6);

    const prompt = await db.orm.public.Prompt.where({ id: raceSeed.id }).first();
    expect(prompt?.scope).toBe("SYSTEM_DEFAULT");
    for (const id of componentIds) {
      expect(await db.orm.public.PromptComponent.where({ id }).first()).toBeTruthy();
    }
    const links = await db.orm.public.PromptComponentLink.where((l) =>
      l.promptId.eq(raceSeed.id),
    ).all();
    expect(links.map((l) => l.id).toSorted((a, b) => a.localeCompare(b))).toEqual(linkIds);
  });

  it("heals soft-deleted or disabled seed rows under concurrent callers", async () => {
    const now = Temporal.Now.plainDateTimeISO();
    await db.orm.public.Prompt.where({ id: raceSeed.id }).update({
      deletedAt: now,
      isActive: false,
      updatedAt: now,
    });
    await db.orm.public.PromptComponent.where({ id: componentIds[0] }).update({
      deletedAt: now,
      updatedAt: now,
    });
    await db.orm.public.PromptComponentLink.where({ id: linkIds[0] }).update({
      deletedAt: now,
      enabled: false,
      position: 9,
      updatedAt: now,
    });

    await expect(
      Promise.all(Array.from({ length: 4 }, () => ensureSystemDefaultPrompts())),
    ).resolves.toHaveLength(4);

    const prompt = await db.orm.public.Prompt.where({ id: raceSeed.id }).first();
    expect(prompt?.deletedAt).toBeNull();
    expect(prompt?.isActive).toBe(true);

    const component = await db.orm.public.PromptComponent.where({ id: componentIds[0] }).first();
    expect(component?.deletedAt).toBeNull();

    const link = await db.orm.public.PromptComponentLink.where({ id: linkIds[0] }).first();
    expect(link?.deletedAt).toBeNull();
    expect(link?.enabled).toBe(true);
    expect(link?.position).toBe(0);
  });
});
