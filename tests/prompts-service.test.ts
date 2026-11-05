import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { Temporal } from "temporal-polyfill";
import { db } from "../src/lib/prisma";
import {
  createPrompt,
  duplicatePromptToLibrary,
  ensureSystemDefaultPrompts,
  getPrompt,
  listPrompts,
  PromptError,
  resolvePromptForMode,
  softDeletePrompt,
  updatePrompt,
} from "../src/lib/prompts";

describe("prompt service resolution + read-only (STO-1158)", { timeout: 30_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = `test-prompt-user-${runId}`;
  const otherUserId = `test-prompt-other-${runId}`;
  let novelId = "";

  beforeAll(async () => {
    const now = Temporal.Now.plainDateTimeISO();
    await db.orm.public.User.upsert({
      create: { id: userId, email: `prompt-${runId}@inkstory.local`, updatedAt: now },
      update: { updatedAt: now },
    });
    await db.orm.public.User.upsert({
      create: { id: otherUserId, email: `prompt-other-${runId}@inkstory.local`, updatedAt: now },
      update: { updatedAt: now },
    });
    const novel = await db.orm.public.Novel.create({
      id: crypto.randomUUID(),
      ownerId: userId,
      title: `Prompt Novel ${runId}`,
      position: 0,
      updatedAt: now,
    });
    novelId = novel.id;
    await ensureSystemDefaultPrompts();
  });

  afterAll(async () => {
    const now = Temporal.Now.plainDateTimeISO();
    const prompts = await db.orm.public.Prompt.where((p) => p.ownerId.eq(userId)).all();
    for (const p of prompts) {
      await db.orm.public.Prompt.where({ id: p.id }).update({ deletedAt: now, updatedAt: now });
    }
    const comps = await db.orm.public.PromptComponent.where((c) => c.ownerId.eq(userId)).all();
    for (const c of comps) {
      await db.orm.public.PromptComponent.where({ id: c.id }).update({
        deletedAt: now,
        updatedAt: now,
      });
    }
    await db.orm.public.Novel.where({ id: novelId }).update({ deletedAt: now, updatedAt: now });
    await db.orm.public.User.where({ id: userId }).delete();
    await db.orm.public.User.where({ id: otherUserId }).delete();
  });

  it("seeds SYSTEM_DEFAULT prompts for both modes", async () => {
    const listed = await listPrompts(userId, { includeSystem: true });
    const systems = listed.filter((p) => p.scope === "SYSTEM_DEFAULT");
    expect(systems.some((p) => p.mode === "continuation")).toBe(true);
    expect(systems.some((p) => p.mode === "beat_expansion")).toBe(true);
  });

  it("resolves novel → user → SYSTEM_DEFAULT", async () => {
    const system = await resolvePromptForMode(userId, "continuation", novelId);
    expect(system.scope).toBe("SYSTEM_DEFAULT");

    const userPrompt = await createPrompt(userId, {
      name: "My continuation",
      mode: "continuation",
      body: "User body {{novel.title}}",
      role: "USER",
    });
    const resolvedUser = await resolvePromptForMode(userId, "continuation", novelId);
    expect(resolvedUser.id).toBe(userPrompt.id);
    expect(resolvedUser.scope).toBe("USER");

    const novelPrompt = await createPrompt(userId, {
      name: "Novel continuation",
      mode: "continuation",
      novelId,
      body: "Novel body",
      role: "USER",
    });
    const resolvedNovel = await resolvePromptForMode(userId, "continuation", novelId);
    expect(resolvedNovel.id).toBe(novelPrompt.id);
    expect(resolvedNovel.scope).toBe("NOVEL");

    await softDeletePrompt(userId, novelPrompt.id);
    await softDeletePrompt(userId, userPrompt.id);
  });

  it("rejects writes to SYSTEM_DEFAULT (read-only)", async () => {
    const system = await resolvePromptForMode(userId, "continuation", null);
    expect(system.scope).toBe("SYSTEM_DEFAULT");
    await expect(updatePrompt(userId, system.id, { name: "hacked" })).rejects.toMatchObject({
      code: "READ_ONLY",
      status: 403,
    });
    await expect(softDeletePrompt(userId, system.id)).rejects.toBeInstanceOf(PromptError);
  });

  it("duplicates SYSTEM_DEFAULT into the user library", async () => {
    const system = await resolvePromptForMode(userId, "beat_expansion", null);
    const copy = await duplicatePromptToLibrary(userId, system.id);
    expect(copy.scope).toBe("USER");
    expect(copy.ownerId).toBe(userId);
    expect(copy.name).toContain("(copy)");
    expect(copy.mode).toBe("beat_expansion");
    const full = await getPrompt(userId, copy.id);
    expect((full.components ?? []).length).toBeGreaterThan(0);
    // Copy should be editable
    const updated = await updatePrompt(userId, copy.id, { name: "Edited copy" });
    expect(updated.name).toBe("Edited copy");
    await softDeletePrompt(userId, copy.id);
  });

  it("rejects creating prompts with SYSTEM_DEFAULT or invalid scope", async () => {
    await expect(
      createPrompt(userId, {
        name: "Forbidden System",
        mode: "continuation",
        scope: "SYSTEM_DEFAULT" as any,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    });

    await expect(
      createPrompt(userId, {
        name: "Invalid Scope",
        mode: "continuation",
        scope: "NON_EXISTENT_SCOPE" as any,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    });
  });

  it("repairs partially seeded or damaged SYSTEM_DEFAULT prompts", async () => {
    const linkId = "sys-prompt-continuation-link-0";
    const now = Temporal.Now.plainDateTimeISO();
    // Simulate accidental link deletion
    await db.orm.public.PromptComponentLink.where({ id: linkId }).update({
      deletedAt: now,
      enabled: false,
      updatedAt: now,
    });

    // ensureSystemDefaultPrompts must heal it
    await ensureSystemDefaultPrompts();

    const link = await db.orm.public.PromptComponentLink.where({ id: linkId }).first();
    expect(link).not.toBeNull();
    expect(link?.deletedAt).toBeNull();
    expect(link?.enabled).toBe(true);
  });

  it("rolls back atomically in transaction if updatePrompt link update fails", async () => {
    const prompt = await createPrompt(userId, {
      name: "Original Name",
      mode: "continuation",
    });

    // Attempt update with invalid componentId
    await expect(
      updatePrompt(userId, prompt.id, {
        name: "Should Not Persist",
        componentIds: ["non-existent-comp-id"],
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });

    // Verify row was NOT modified
    const current = await getPrompt(userId, prompt.id);
    expect(current.name).toBe("Original Name");

    await softDeletePrompt(userId, prompt.id);
  });
});

describe("prompt component CRUD (STO-1158)", { timeout: 30_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = `test-comp-user-${runId}`;

  beforeAll(async () => {
    const now = Temporal.Now.plainDateTimeISO();
    await db.orm.public.User.upsert({
      create: { id: userId, email: `comp-${runId}@inkstory.local`, updatedAt: now },
      update: { updatedAt: now },
    });
    await ensureSystemDefaultPrompts();
  });

  afterAll(async () => {
    const now = Temporal.Now.plainDateTimeISO();
    const comps = await db.orm.public.PromptComponent.where((c) => c.ownerId.eq(userId)).all();
    for (const c of comps) {
      await db.orm.public.PromptComponent.where({ id: c.id }).update({
        deletedAt: now,
        updatedAt: now,
      });
    }
    const prompts = await db.orm.public.Prompt.where((p) => p.ownerId.eq(userId)).all();
    for (const p of prompts) {
      await db.orm.public.Prompt.where({ id: p.id }).update({ deletedAt: now, updatedAt: now });
    }
    await db.orm.public.User.where({ id: userId }).delete();
  });

  it("creates, lists, updates, and soft-deletes user components", async () => {
    const {
      createComponent,
      listComponents,
      updateComponent,
      softDeleteComponent,
      createPrompt,
      softDeletePrompt,
    } = await import("../src/lib/prompts");

    const created = await createComponent(userId, {
      name: "Style rules",
      body: "Prefer short sentences. {{mode}}",
      role: "SYSTEM",
    });
    expect(created.ownerId).toBe(userId);
    expect(created.body).toContain("{{mode}}");

    const listed = await listComponents(userId);
    expect(listed.some((c) => c.id === created.id)).toBe(true);
    // System components (owner null) are visible too
    expect(listed.some((c) => c.ownerId === null)).toBe(true);

    const updated = await updateComponent(userId, created.id, {
      name: "Style rules v2",
      body: "Prefer long sentences.",
    });
    expect(updated.name).toBe("Style rules v2");

    const prompt = await createPrompt(userId, {
      name: "With component",
      mode: "continuation",
      body: "",
      componentIds: [created.id],
    });
    const full = await getPrompt(userId, prompt.id);
    expect(full.components?.[0]?.componentId).toBe(created.id);

    await softDeletePrompt(userId, prompt.id);
    await softDeleteComponent(userId, created.id);
    const after = await listComponents(userId);
    expect(after.some((c) => c.id === created.id)).toBe(false);
  });

  it("rejects mutating system components", async () => {
    const { listComponents, updateComponent, softDeleteComponent, PromptError } =
      await import("../src/lib/prompts");
    const listed = await listComponents(userId);
    const systemComp = listed.find((c) => c.ownerId === null);
    expect(systemComp).toBeTruthy();
    await expect(updateComponent(userId, systemComp!.id, { name: "x" })).rejects.toMatchObject({
      code: "READ_ONLY",
    });
    await expect(softDeleteComponent(userId, systemComp!.id)).rejects.toBeInstanceOf(PromptError);
  });

  it("handlePromptApiError maps PromptError and SyntaxError", async () => {
    const { handlePromptApiError, PromptError } = await import("../src/lib/prompts");
    const a = handlePromptApiError(new PromptError("nope", "NOT_FOUND", 404));
    expect(a.status).toBe(404);
    const b = handlePromptApiError(new SyntaxError("bad json"));
    expect(b.status).toBe(400);
    const c = handlePromptApiError(new Error("boom"));
    expect(c.status).toBe(500);
  });

  it("validates component input and permissions", async () => {
    const { createComponent, updateComponent, softDeleteComponent } =
      await import("../src/lib/prompts");

    await expect(createComponent(userId, { name: "", body: "body" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    });
    await expect(
      createComponent(userId, { name: "Name", body: null as any }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    });

    await expect(updateComponent(userId, "non-existent-comp", { name: "x" })).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
        status: 404,
      },
    );
    await expect(softDeleteComponent(userId, "non-existent-comp")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("reuses user owned components when duplicating a user prompt", async () => {
    const {
      createComponent,
      createPrompt,
      duplicatePromptToLibrary,
      softDeletePrompt,
      softDeleteComponent,
    } = await import("../src/lib/prompts");
    const comp = await createComponent(userId, { name: "User Comp", body: "User Comp Body" });
    const userPrompt = await createPrompt(userId, {
      name: "User Prompt With Own Comp",
      mode: "continuation",
      componentIds: [comp.id],
    });

    const duplicate = await duplicatePromptToLibrary(userId, userPrompt.id);
    expect(duplicate.components?.[0]?.componentId).toBe(comp.id);

    await softDeletePrompt(userId, duplicate.id);
    await softDeletePrompt(userId, userPrompt.id);
    await softDeleteComponent(userId, comp.id);
  });
});

describe("renderResolvedScenePrompt (STO-1158)", { timeout: 20_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = `test-render-user-${runId}`;

  beforeAll(async () => {
    const now = Temporal.Now.plainDateTimeISO();
    await db.orm.public.User.upsert({
      create: { id: userId, email: `render-${runId}@inkstory.local`, updatedAt: now },
      update: { updatedAt: now },
    });
    await ensureSystemDefaultPrompts();
  });

  afterAll(async () => {
    await db.orm.public.User.where({ id: userId }).delete();
  });

  it("renders SYSTEM_DEFAULT via DB parts into messages + joined", async () => {
    const { renderResolvedScenePrompt } = await import("../src/lib/prompts");
    const rendered = await renderResolvedScenePrompt(userId, null, {
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
    });
    expect(rendered.prompt.scope).toBe("SYSTEM_DEFAULT");
    expect(rendered.messages).toHaveLength(2);
    expect(rendered.messages[0].content).toContain("Storm Tide");
    expect(rendered.joined).toContain("--- system ---");
    expect(rendered.unresolved).toEqual([]);
  });
});
