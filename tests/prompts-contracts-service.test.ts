import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { Temporal } from "temporal-polyfill";
import { db } from "../src/lib/prisma";
import {
  createComponent,
  createPrompt,
  duplicatePromptToLibrary,
  ensureSystemDefaultPrompts,
  exportComponent,
  getPrompt,
  importComponent,
  listComponents,
  renderDefaultScenePrompt,
  renderResolvedScenePrompt,
  softDeleteComponent,
  softDeletePrompt,
  updateComponent,
  type ScenePromptBindingInput,
} from "../src/lib/prompts";

const contractInput = {
  schemaVersion: 1,
  inputs: [
    { key: "craft.selection", type: "text", required: true },
    { key: "craft.target_words", type: "integer", min: 50, max: 300 },
  ],
  contextSlices: ["selection", "scene.pov"],
  output: { mode: "prose", suggestedAction: "replace_selection" },
  attribution: { author: "Original Author", license: null, source: null },
};

const canonicalContract = {
  schemaVersion: 1,
  inputs: [
    { key: "craft.selection", type: "text", required: true },
    { key: "craft.target_words", type: "integer", required: false, min: 50, max: 300 },
  ],
  contextSlices: ["selection", "scene.pov"],
  output: { mode: "prose", suggestedAction: "replace_selection" },
  attribution: { author: "Original Author", license: null, source: null },
};

const sceneInput: ScenePromptBindingInput = {
  mode: "continuation",
  novelTitle: "Storm Tide",
  chapterTitle: "Chapter 1",
  sceneTitle: "The Quay",
  povLabel: "Third person limited",
  tenseLabel: "Past",
  sceneContent: "Mara reached the quay.",
  summary: null,
  beatText: null,
  codexPrompt: "<codex_context>\n<story_bible></story_bible>\n</codex_context>",
};

describe("prompt component contracts — service (STO-1275)", { timeout: 30_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = `test-contract-user-${runId}`;
  const otherUserId = `test-contract-other-${runId}`;
  const systemComponentId = `test-contract-system-${runId}`;

  beforeAll(async () => {
    const now = Temporal.Now.plainDateTimeISO();
    for (const id of [userId, otherUserId]) {
      await db.orm.public.User.upsert({
        create: { id, email: `${id}@inkstory.local`, updatedAt: now },
        update: { updatedAt: now },
      });
    }
    await ensureSystemDefaultPrompts();
  });

  afterAll(async () => {
    await db.orm.public.PromptComponent.where({ id: systemComponentId }).delete();
    // Cascades remove the users' prompts, links and components.
    await db.orm.public.User.where({ id: userId }).delete();
    await db.orm.public.User.where({ id: otherUserId }).delete();
  });

  async function ownedComponentCount(owner: string): Promise<number> {
    const rows = await db.orm.public.PromptComponent.where((c) => c.ownerId.eq(owner)).all();
    return rows.length;
  }

  it("keeps legacy rows null and renders SYSTEM_DEFAULT byte-for-byte as before", async () => {
    const seeded = await db.orm.public.PromptComponent.where({
      id: "sys-prompt-continuation-system",
    }).first();
    expect(seeded?.contract ?? null).toBeNull();

    const rendered = await renderResolvedScenePrompt(userId, null, sceneInput);
    const offline = renderDefaultScenePrompt(sceneInput);
    expect(rendered.prompt.scope).toBe("SYSTEM_DEFAULT");
    expect(rendered.messages).toEqual(offline.messages);
    expect(rendered.joined).toBe(offline.joined);
    expect(rendered).not.toHaveProperty("unresolvedInputs");

    const listed = await listComponents(userId);
    const system = listed.find((c) => c.id === "sys-prompt-continuation-system");
    expect(system?.contract).toBeNull();
  });

  it("creates components with a validated canonical contract (or null)", async () => {
    const legacy = await createComponent(userId, { name: "Legacy", body: "Body" });
    expect(legacy.contract).toBeNull();

    const withContract = await createComponent(userId, {
      name: "Describe",
      body: "Describe {{craft.selection}}",
      role: "USER",
      contract: contractInput,
      ownerId: otherUserId,
    } as any);
    expect(withContract.ownerId).toBe(userId);
    expect(withContract.contract).toEqual(canonicalContract);

    const row = await db.orm.public.PromptComponent.where({ id: withContract.id }).first();
    expect(row?.contract).toEqual(canonicalContract);
    expect(row?.ownerId).toBe(userId);

    const listed = await listComponents(userId);
    expect(listed.find((c) => c.id === withContract.id)?.contract).toEqual(canonicalContract);
  });

  it("rejects invalid, oversize and unknown-version contracts before persistence", async () => {
    const before = await ownedComponentCount(userId);
    await expect(
      createComponent(userId, {
        name: "Bad",
        body: "x",
        contract: { schemaVersion: 1, inputs: [{ key: "env.SECRET", type: "text" }] },
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONTRACT", status: 422 });
    await expect(
      createComponent(userId, { name: "Future", body: "x", contract: { schemaVersion: 2 } }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_VERSION", status: 422 });
    await expect(
      createComponent(userId, {
        name: "Huge",
        body: "x",
        contract: {
          schemaVersion: 1,
          attribution: { author: "a", source: "s".repeat(70_000) },
        },
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
    expect(await ownedComponentCount(userId)).toBe(before);
  });

  it("updates: undefined keeps, object replaces, null clears, invalid rejects", async () => {
    const created = await createComponent(userId, {
      name: "Updatable",
      body: "{{craft.selection}}",
      contract: contractInput,
    });

    const renamed = await updateComponent(userId, created.id, { name: "Renamed" });
    expect(renamed.contract).toEqual(canonicalContract);

    const replaced = await updateComponent(userId, created.id, {
      contract: { schemaVersion: 1, output: { mode: "options" } },
    });
    expect(replaced.contract).toEqual({
      schemaVersion: 1,
      inputs: [],
      contextSlices: [],
      output: { mode: "options", suggestedAction: null },
      attribution: null,
    });

    await expect(
      updateComponent(userId, created.id, {
        contract: { schemaVersion: 1, contextSlices: ["codex.semantic_search"] },
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONTRACT" });
    const row = await db.orm.public.PromptComponent.where({ id: created.id }).first();
    expect((row?.contract as { output: unknown } | null)?.output).toEqual({
      mode: "options",
      suggestedAction: null,
    });

    const cleared = await updateComponent(userId, created.id, { contract: null });
    expect(cleared.contract).toBeNull();
  });

  it("rejects other-user, soft-deleted and owner-null components", async () => {
    const theirs = await createComponent(otherUserId, {
      name: "Theirs",
      body: "x",
      contract: contractInput,
    });
    await expect(
      updateComponent(userId, theirs.id, { contract: { schemaVersion: 1 } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(exportComponent(userId, theirs.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });

    const mine = await createComponent(userId, { name: "Gone", body: "x" });
    await softDeleteComponent(userId, mine.id);
    await expect(
      updateComponent(userId, mine.id, { contract: { schemaVersion: 1 } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(exportComponent(userId, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(exportComponent(userId, "missing-component")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    await expect(
      updateComponent(userId, "sys-prompt-continuation-system", {
        contract: { schemaVersion: 1 },
      }),
    ).rejects.toMatchObject({ code: "READ_ONLY", status: 403 });
  });

  it("duplicate copies the contract and moves ownership to the duplicating user", async () => {
    const now = Temporal.Now.plainDateTimeISO();
    // Owner-null (system-library) component carrying a contract with attribution.
    await db.orm.public.PromptComponent.create({
      id: systemComponentId,
      name: "Shared describe",
      description: null,
      body: "Describe {{craft.selection}}",
      role: "USER",
      contract: canonicalContract as any,
      ownerId: null,
      updatedAt: now,
    });
    const own = await createComponent(userId, { name: "Own part", body: "Own" });
    const prompt = await createPrompt(userId, {
      name: "Craft prompt",
      mode: "beat_expansion",
      componentIds: [systemComponentId, own.id],
    });

    const copy = await duplicatePromptToLibrary(userId, prompt.id);
    const full = await getPrompt(userId, copy.id);
    const copied = full.components?.[0]?.component;
    expect(copied?.id).not.toBe(systemComponentId);
    expect(copied?.ownerId).toBe(userId);
    expect(copied?.contract).toEqual(canonicalContract);
    expect(copied?.contract?.attribution?.author).toBe("Original Author");
    // Own components are reused, not copied.
    expect(full.components?.[1]?.componentId).toBe(own.id);

    // The source system component is untouched.
    const source = await db.orm.public.PromptComponent.where({ id: systemComponentId }).first();
    expect(source?.ownerId).toBeNull();

    await softDeletePrompt(userId, copy.id);
    await softDeletePrompt(userId, prompt.id);
  });

  it("duplicate rejects a copied component whose stored contract no longer validates", async () => {
    const tamperedId = `${systemComponentId}-tampered`;
    await db.orm.public.PromptComponent.create({
      id: tamperedId,
      name: "Tampered shared",
      description: null,
      body: "x",
      role: "USER",
      contract: { schemaVersion: 9 } as any,
      ownerId: null,
      updatedAt: Temporal.Now.plainDateTimeISO(),
    });
    const prompt = await createPrompt(userId, {
      name: "Tampered prompt",
      mode: "beat_expansion",
      componentIds: [tamperedId],
    });
    try {
      await expect(duplicatePromptToLibrary(userId, prompt.id)).rejects.toMatchObject({
        code: "UNSUPPORTED_VERSION",
      });
    } finally {
      await softDeletePrompt(userId, prompt.id);
      await db.orm.public.PromptComponent.where({ id: tamperedId }).delete();
    }
  });

  it("a contract never changes how an existing prompt renders", async () => {
    const body = "Continue {{novel.title}} {{craft.selection}}";
    const legacy = await createComponent(userId, { name: "L", body, role: "USER" });
    const contracted = await createComponent(userId, {
      name: "C",
      body,
      role: "USER",
      contract: contractInput,
    });

    const p1 = await createPrompt(userId, {
      name: "legacy",
      mode: "continuation",
      componentIds: [legacy.id],
    });
    const r1 = await renderResolvedScenePrompt(userId, null, sceneInput);
    await softDeletePrompt(userId, p1.id);

    const p2 = await createPrompt(userId, {
      name: "contracted",
      mode: "continuation",
      componentIds: [contracted.id],
    });
    const r2 = await renderResolvedScenePrompt(userId, null, sceneInput);
    await softDeletePrompt(userId, p2.id);

    expect(r2.messages).toEqual(r1.messages);
    expect(r2.messages[0].content).toBe("Continue Storm Tide {{craft.selection}}");
    expect(r2.unknownTokens).toEqual(r1.unknownTokens);
  });

  it("exports own and system components as data-only envelopes", async () => {
    const created = await createComponent(userId, {
      name: "Exportable",
      description: "desc",
      body: "{{craft.selection}}",
      role: "USER",
      contract: contractInput,
    });
    const exported = await exportComponent(userId, created.id);
    expect(exported).toEqual({
      format: "inkstory.prompt-component",
      formatVersion: 1,
      component: {
        name: "Exportable",
        description: "desc",
        body: "{{craft.selection}}",
        role: "USER",
        contract: canonicalContract,
      },
    });
    const json = JSON.stringify(exported);
    expect(json).not.toContain(created.id);
    expect(json).not.toContain(userId);

    const system = await exportComponent(userId, "sys-prompt-continuation-system");
    expect(system.component.contract).toBeNull();
    expect(system.component.role).toBe("SYSTEM");
  });

  it("refuses to export a stored contract that no longer validates", async () => {
    const created = await createComponent(userId, { name: "Tampered", body: "x" });
    await db.orm.public.PromptComponent.where({ id: created.id }).update({
      contract: { schemaVersion: 9 } as any,
    });
    const listed = await listComponents(userId);
    expect(listed.find((c) => c.id === created.id)?.contract).toBeNull();
    await expect(exportComponent(userId, created.id)).rejects.toMatchObject({
      code: "UNSUPPORTED_VERSION",
    });
  });

  it("imports as a NEW user-owned component and never overwrites", async () => {
    const original = await createComponent(userId, {
      name: "Round trip",
      body: "Describe {{craft.selection}}",
      role: "USER",
      contract: contractInput,
    });
    const envelope = await exportComponent(userId, original.id);

    const imported = await importComponent(otherUserId, envelope);
    expect(imported.id).not.toBe(original.id);
    expect(imported.ownerId).toBe(otherUserId);
    expect(imported.contract).toEqual(canonicalContract);
    expect(imported.name).toBe("Round trip");

    const again = await importComponent(otherUserId, envelope);
    expect(again.id).not.toBe(imported.id);

    const untouched = await db.orm.public.PromptComponent.where({ id: original.id }).first();
    expect(untouched?.ownerId).toBe(userId);

    await expect(
      importComponent(userId, {
        ...envelope,
        component: { ...envelope.component, ownerId: null },
      }),
    ).rejects.toMatchObject({ code: "INVALID_PORTABLE", status: 422 });
    await expect(importComponent(userId, { ...envelope, formatVersion: 2 })).rejects.toMatchObject({
      code: "UNSUPPORTED_VERSION",
    });
  });
});
