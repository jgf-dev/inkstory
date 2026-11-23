import { afterAll, describe, expect, it, vi } from "vite-plus/test";
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
    expect(links.map((l) => l.id).sort()).toEqual(linkIds);
  });
});
