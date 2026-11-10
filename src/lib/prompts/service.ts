/**
 * Prompt + component CRUD, resolution, and preview (STO-1158).
 * Component contracts + portable import/export (STO-1275).
 *
 * Resolution order (EL): novel active → user default for mode → SYSTEM_DEFAULT.
 * SYSTEM_DEFAULT rows are read-only; use duplicatePromptToLibrary.
 */

import { Temporal } from "temporal-polyfill";
import { db, type DbClient } from "@/lib/prisma";
import type { GenerationMode } from "@/lib/ai/generate";
import { GENERATION_MODES } from "@/lib/ai/generate";
import { normalizePromptContract, readStoredContract } from "./contracts";
import { SYSTEM_DEFAULT_SEED } from "./defaults";
import { PromptError } from "./errors";
import {
  parsePortableEnvelope,
  toPortableEnvelope,
  type PortablePromptComponentEnvelope,
} from "./portable";
import { buildSceneBindings, renderPrompt } from "./render";
import type {
  CreateComponentInput,
  CreatePromptInput,
  PromptComponentDto,
  PromptDto,
  PromptPart,
  PromptRoleName,
  PromptScopeName,
  RenderedPrompt,
  ScenePromptBindingInput,
  UpdateComponentInput,
  UpdatePromptInput,
} from "./types";

export { PromptError, handlePromptApiError } from "./errors";

type PromptRow = {
  id: string;
  name: string;
  description: string | null;
  mode: string;
  scope: PromptScopeName;
  body: string;
  role: PromptRoleName;
  position: number;
  isActive: boolean;
  ownerId: string | null;
  novelId: string | null;
  createdAt: Temporal.PlainDateTime;
  updatedAt: Temporal.PlainDateTime;
  deletedAt: Temporal.PlainDateTime | null;
};

type ComponentRow = {
  id: string;
  name: string;
  description: string | null;
  body: string;
  role: PromptRoleName;
  contract: unknown;
  ownerId: string | null;
  createdAt: Temporal.PlainDateTime;
  updatedAt: Temporal.PlainDateTime;
  deletedAt: Temporal.PlainDateTime | null;
};

type LinkRow = {
  id: string;
  promptId: string;
  componentId: string;
  position: number;
  enabled: boolean;
  createdAt: Temporal.PlainDateTime;
  updatedAt: Temporal.PlainDateTime;
  deletedAt: Temporal.PlainDateTime | null;
};

function roleToMessageRole(role: PromptRoleName): "system" | "user" {
  return role === "USER" ? "user" : "system";
}

function toPromptDto(row: PromptRow): PromptDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    mode: row.mode,
    scope: row.scope,
    body: row.body,
    role: row.role,
    position: row.position,
    isActive: row.isActive,
    ownerId: row.ownerId,
    novelId: row.novelId,
    updatedAt: row.updatedAt.toString(),
  };
}

function toComponentDto(row: ComponentRow): PromptComponentDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    body: row.body,
    role: row.role,
    contract: readStoredContract(row.contract),
    ownerId: row.ownerId,
    updatedAt: row.updatedAt.toString(),
  };
}

function assertMode(mode: string): void {
  if (!(GENERATION_MODES as readonly string[]).includes(mode)) {
    throw new PromptError(
      `mode must be one of: ${(GENERATION_MODES as readonly string[]).join(", ")}`,
      "VALIDATION_FAILED",
      400,
    );
  }
}

type DbHandle = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

async function assertNovelOwned(userId: string, novelId: string): Promise<void> {
  const novel = await db.orm.public.Novel.where({ id: novelId }).first();
  if (!novel || novel.deletedAt !== null || novel.ownerId !== userId) {
    throw new PromptError("Novel not found", "NOT_FOUND", 404);
  }
}

async function loadPromptRow(id: string, client: DbHandle = db): Promise<PromptRow | null> {
  const row = (await client.orm.public.Prompt.where({ id }).first()) as PromptRow | null;
  if (!row || row.deletedAt) return null;
  return row;
}

async function loadComponentRow(id: string, client: DbHandle = db): Promise<ComponentRow | null> {
  const row = (await client.orm.public.PromptComponent.where({
    id,
  }).first()) as ComponentRow | null;
  if (!row || row.deletedAt) return null;
  return row;
}

async function validateComponentIds(
  userId: string,
  componentIds: string[],
  client: DbHandle = db,
): Promise<void> {
  for (const componentId of componentIds) {
    const component = await loadComponentRow(componentId, client);
    if (!component) {
      throw new PromptError(`Component not found: ${componentId}`, "NOT_FOUND", 404);
    }
    // User library components (owner = user) or system (owner null) may be linked.
    if (component.ownerId !== null && component.ownerId !== userId) {
      throw new PromptError(`Component not found: ${componentId}`, "NOT_FOUND", 404);
    }
  }
}

function assertCanReadPrompt(userId: string, row: PromptRow): void {
  if (row.scope === "SYSTEM_DEFAULT") return;
  if (row.ownerId === userId) return;
  throw new PromptError("Prompt not found", "NOT_FOUND", 404);
}

function assertCanWritePrompt(userId: string, row: PromptRow): void {
  if (row.scope === "SYSTEM_DEFAULT" || row.ownerId === null) {
    throw new PromptError(
      "SYSTEM_DEFAULT prompts are read-only; Duplicate to your library instead",
      "READ_ONLY",
      403,
    );
  }
  if (row.ownerId !== userId) {
    throw new PromptError("Prompt not found", "NOT_FOUND", 404);
  }
}

/** Idempotent seed of SYSTEM_DEFAULT prompts for continuation + beat_expansion (self-healing). */
export async function ensureSystemDefaultPrompts(): Promise<void> {
  const now = Temporal.Now.plainDateTimeISO();
  for (const seed of SYSTEM_DEFAULT_SEED) {
    const existingPrompt = (await db.orm.public.Prompt.where({
      id: seed.id,
    }).first()) as PromptRow | null;
    if (!existingPrompt) {
      await db.orm.public.Prompt.create({
        id: seed.id,
        name: seed.name,
        description: seed.description,
        mode: seed.mode,
        scope: "SYSTEM_DEFAULT",
        body: "",
        role: "SYSTEM",
        position: 0,
        isActive: true,
        ownerId: null,
        novelId: null,
        updatedAt: now,
      });
    } else if (existingPrompt.deletedAt) {
      await db.orm.public.Prompt.where({ id: seed.id }).update({
        deletedAt: null,
        isActive: true,
        updatedAt: now,
      });
    }

    const systemComponentId = `${seed.id}-system`;
    const userComponentId = `${seed.id}-user`;

    const existingSys = (await db.orm.public.PromptComponent.where({
      id: systemComponentId,
    }).first()) as ComponentRow | null;
    if (!existingSys) {
      await db.orm.public.PromptComponent.create({
        id: systemComponentId,
        name: `${seed.name} — system`,
        description: null,
        body: seed.systemBody,
        role: "SYSTEM",
        ownerId: null,
        updatedAt: now,
      });
    } else if (existingSys.deletedAt) {
      await db.orm.public.PromptComponent.where({ id: systemComponentId }).update({
        deletedAt: null,
        updatedAt: now,
      });
    }

    const existingUser = (await db.orm.public.PromptComponent.where({
      id: userComponentId,
    }).first()) as ComponentRow | null;
    if (!existingUser) {
      await db.orm.public.PromptComponent.create({
        id: userComponentId,
        name: `${seed.name} — user`,
        description: null,
        body: seed.userBody,
        role: "USER",
        ownerId: null,
        updatedAt: now,
      });
    } else if (existingUser.deletedAt) {
      await db.orm.public.PromptComponent.where({ id: userComponentId }).update({
        deletedAt: null,
        updatedAt: now,
      });
    }

    const link0Id = `${seed.id}-link-0`;
    const link0 = (await db.orm.public.PromptComponentLink.where({
      id: link0Id,
    }).first()) as LinkRow | null;
    if (!link0) {
      await db.orm.public.PromptComponentLink.create({
        id: link0Id,
        promptId: seed.id,
        componentId: systemComponentId,
        position: 0,
        enabled: true,
        updatedAt: now,
      });
    } else if (link0.deletedAt || !link0.enabled || link0.position !== 0) {
      await db.orm.public.PromptComponentLink.where({ id: link0Id }).update({
        deletedAt: null,
        enabled: true,
        position: 0,
        updatedAt: now,
      });
    }

    const link1Id = `${seed.id}-link-1`;
    const link1 = (await db.orm.public.PromptComponentLink.where({
      id: link1Id,
    }).first()) as LinkRow | null;
    if (!link1) {
      await db.orm.public.PromptComponentLink.create({
        id: link1Id,
        promptId: seed.id,
        componentId: userComponentId,
        position: 1,
        enabled: true,
        updatedAt: now,
      });
    } else if (link1.deletedAt || !link1.enabled || link1.position !== 1) {
      await db.orm.public.PromptComponentLink.where({ id: link1Id }).update({
        deletedAt: null,
        enabled: true,
        position: 1,
        updatedAt: now,
      });
    }
  }
}

async function loadEnabledParts(
  promptId: string,
  promptRole: PromptRoleName,
  body: string,
): Promise<PromptPart[]> {
  const links = (await db.orm.public.PromptComponentLink.where((l) => l.promptId.eq(promptId))
    .where((l) => l.deletedAt.isNull())
    .all()) as LinkRow[];

  const enabled = links.filter((l) => l.enabled).sort((a, b) => a.position - b.position);
  const parts: PromptPart[] = [];

  for (const link of enabled) {
    const component = await loadComponentRow(link.componentId);
    if (!component) continue;
    parts.push({
      role: roleToMessageRole(component.role),
      body: component.body,
      name: component.name,
    });
  }

  if (body.trim()) {
    parts.push({ role: roleToMessageRole(promptRole), body, name: "prompt-body" });
  }

  return parts;
}

export async function listPrompts(
  userId: string,
  opts: { mode?: string; novelId?: string; includeSystem?: boolean } = {},
): Promise<PromptDto[]> {
  await ensureSystemDefaultPrompts();

  const rows = (await db.orm.public.Prompt.where((p) => p.deletedAt.isNull()).all()) as PromptRow[];
  const filtered = rows.filter((row) => {
    if (opts.mode && row.mode !== opts.mode) return false;
    if (row.scope === "SYSTEM_DEFAULT") return opts.includeSystem !== false;
    if (row.ownerId !== userId) return false;
    if (opts.novelId) {
      if (row.scope === "NOVEL") return row.novelId === opts.novelId;
      // user library prompts are visible alongside novel-scoped when filtering by novel
      return row.scope === "USER";
    }
    return true;
  });

  filtered.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  return filtered.map(toPromptDto);
}

export async function getPrompt(userId: string, promptId: string): Promise<PromptDto> {
  await ensureSystemDefaultPrompts();
  const row = await loadPromptRow(promptId);
  if (!row) throw new PromptError("Prompt not found", "NOT_FOUND", 404);
  assertCanReadPrompt(userId, row);

  const dto = toPromptDto(row);
  const links = (await db.orm.public.PromptComponentLink.where((l) => l.promptId.eq(promptId))
    .where((l) => l.deletedAt.isNull())
    .all()) as LinkRow[];
  const sorted = links.sort((a, b) => a.position - b.position);
  dto.components = [];
  for (const link of sorted) {
    const component = await loadComponentRow(link.componentId);
    dto.components.push({
      id: link.id,
      promptId: link.promptId,
      componentId: link.componentId,
      position: link.position,
      enabled: link.enabled,
      component: component ? toComponentDto(component) : undefined,
    });
  }
  return dto;
}

export async function createPrompt(userId: string, input: CreatePromptInput): Promise<PromptDto> {
  assertMode(input.mode);
  const name = input.name?.trim();
  if (!name) throw new PromptError("name is required", "VALIDATION_FAILED", 400);

  if ((input.scope as string) === "SYSTEM_DEFAULT") {
    throw new PromptError("Cannot create a SYSTEM_DEFAULT prompt", "VALIDATION_FAILED", 400);
  }

  let scope: PromptScopeName = "USER";
  if (input.scope) {
    if (input.scope !== "USER" && input.scope !== "NOVEL") {
      throw new PromptError(
        `Invalid prompt scope: ${String(input.scope)}`,
        "VALIDATION_FAILED",
        400,
      );
    }
    scope = input.scope;
  }

  let novelId: string | null = null;
  if (input.novelId) {
    await assertNovelOwned(userId, input.novelId);
    scope = "NOVEL";
    novelId = input.novelId;
  }
  if (scope === "NOVEL" && !novelId) {
    throw new PromptError("novelId is required for NOVEL scope", "VALIDATION_FAILED", 400);
  }

  if (input.componentIds?.length) {
    await validateComponentIds(userId, input.componentIds);
  }

  const now = Temporal.Now.plainDateTimeISO();
  const created = await db.transaction(async (tx) => {
    const row = (await tx.orm.public.Prompt.create({
      id: crypto.randomUUID(),
      name,
      description: input.description ?? null,
      mode: input.mode,
      scope,
      body: input.body ?? "",
      role: input.role ?? "SYSTEM",
      position: input.position ?? 0,
      isActive: input.isActive ?? true,
      ownerId: userId,
      novelId,
      updatedAt: now,
    })) as PromptRow;

    if (input.componentIds?.length) {
      await replaceLinks(row.id, userId, input.componentIds, tx);
    }
    return row;
  });

  return toPromptDto(created);
}

export async function updatePrompt(
  userId: string,
  promptId: string,
  input: UpdatePromptInput,
): Promise<PromptDto> {
  const row = await loadPromptRow(promptId);
  if (!row) throw new PromptError("Prompt not found", "NOT_FOUND", 404);
  assertCanWritePrompt(userId, row);

  if (input.componentIds) {
    await validateComponentIds(userId, input.componentIds);
  }

  const now = Temporal.Now.plainDateTimeISO();
  const updated = await db.transaction(async (tx) => {
    const promptRow = (await tx.orm.public.Prompt.where({ id: promptId }).update({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: now,
    })) as PromptRow;

    if (input.componentIds) {
      await replaceLinks(promptId, userId, input.componentIds, tx);
    }
    return promptRow;
  });

  return toPromptDto(updated);
}

export async function softDeletePrompt(userId: string, promptId: string): Promise<void> {
  const row = await loadPromptRow(promptId);
  if (!row) throw new PromptError("Prompt not found", "NOT_FOUND", 404);
  assertCanWritePrompt(userId, row);
  const now = Temporal.Now.plainDateTimeISO();
  await db.orm.public.Prompt.where({ id: promptId }).update({ deletedAt: now, updatedAt: now });
}

async function replaceLinks(
  promptId: string,
  userId: string,
  componentIds: string[],
  client: DbHandle = db,
): Promise<void> {
  const now = Temporal.Now.plainDateTimeISO();
  const existing = (await client.orm.public.PromptComponentLink.where((l) =>
    l.promptId.eq(promptId),
  )
    .where((l) => l.deletedAt.isNull())
    .all()) as LinkRow[];
  for (const link of existing) {
    await client.orm.public.PromptComponentLink.where({ id: link.id }).update({
      deletedAt: now,
      updatedAt: now,
    });
  }

  for (let i = 0; i < componentIds.length; i++) {
    const componentId = componentIds[i];
    const component = await loadComponentRow(componentId, client);
    if (!component) {
      throw new PromptError(`Component not found: ${componentId}`, "NOT_FOUND", 404);
    }
    // User library components (owner = user) or system (owner null) may be linked.
    if (component.ownerId !== null && component.ownerId !== userId) {
      throw new PromptError(`Component not found: ${componentId}`, "NOT_FOUND", 404);
    }
    await client.orm.public.PromptComponentLink.create({
      id: crypto.randomUUID(),
      promptId,
      componentId,
      position: i,
      enabled: true,
      updatedAt: now,
    });
  }
}

/** Duplicate a SYSTEM_DEFAULT (or any readable) prompt into the user library. */
export async function duplicatePromptToLibrary(
  userId: string,
  promptId: string,
): Promise<PromptDto> {
  await ensureSystemDefaultPrompts();
  const source = await getPrompt(userId, promptId);
  const now = Temporal.Now.plainDateTimeISO();

  const createdId = await db.transaction(async (tx) => {
    const created = (await tx.orm.public.Prompt.create({
      id: crypto.randomUUID(),
      name: `${source.name} (copy)`,
      description: source.description,
      mode: source.mode,
      scope: "USER",
      body: source.body,
      role: source.role,
      position: source.position,
      isActive: true,
      ownerId: userId,
      novelId: null,
      updatedAt: now,
    })) as PromptRow;

    const componentIds: string[] = [];
    for (const link of source.components ?? []) {
      const src = link.component;
      if (!src) continue;
      // Copy system components into the user library; reuse own components.
      if (src.ownerId === userId) {
        componentIds.push(src.id);
        continue;
      }
      const copy = (await tx.orm.public.PromptComponent.create({
        id: crypto.randomUUID(),
        name: src.name,
        description: src.description,
        body: src.body,
        role: src.role,
        // Contract (incl. attribution) is copied; ownership moves to the duplicating user.
        contract: (src.contract ?? null) as any,
        ownerId: userId,
        updatedAt: now,
      })) as ComponentRow;
      componentIds.push(copy.id);
    }
    if (componentIds.length) {
      await replaceLinks(created.id, userId, componentIds, tx);
    }
    return created.id;
  });

  return getPrompt(userId, createdId);
}

export async function listComponents(userId: string): Promise<PromptComponentDto[]> {
  await ensureSystemDefaultPrompts();
  const rows = (await db.orm.public.PromptComponent.where((c) =>
    c.deletedAt.isNull(),
  ).all()) as ComponentRow[];
  return rows.filter((r) => r.ownerId === userId || r.ownerId === null).map(toComponentDto);
}

export async function createComponent(
  userId: string,
  input: CreateComponentInput,
): Promise<PromptComponentDto> {
  const name = input.name?.trim();
  if (!name) throw new PromptError("name is required", "VALIDATION_FAILED", 400);
  if (typeof input.body !== "string") {
    throw new PromptError("body is required", "VALIDATION_FAILED", 400);
  }
  const contract = normalizePromptContract(input.contract);
  const now = Temporal.Now.plainDateTimeISO();
  const created = (await db.orm.public.PromptComponent.create({
    id: crypto.randomUUID(),
    name,
    description: input.description ?? null,
    body: input.body,
    role: input.role ?? "SYSTEM",
    contract: contract as any,
    // Session identity only; never taken from the request body.
    ownerId: userId,
    updatedAt: now,
  })) as ComponentRow;
  return toComponentDto(created);
}

export async function updateComponent(
  userId: string,
  componentId: string,
  input: UpdateComponentInput,
): Promise<PromptComponentDto> {
  const row = await loadComponentRow(componentId);
  if (!row) throw new PromptError("Component not found", "NOT_FOUND", 404);
  if (row.ownerId === null) {
    throw new PromptError(
      "SYSTEM_DEFAULT components are read-only; Duplicate a prompt to edit",
      "READ_ONLY",
      403,
    );
  }
  if (row.ownerId !== userId) {
    throw new PromptError("Component not found", "NOT_FOUND", 404);
  }
  // undefined → unchanged; null → cleared (legacy); object → validated before persistence.
  const contract =
    input.contract !== undefined ? normalizePromptContract(input.contract) : undefined;
  const now = Temporal.Now.plainDateTimeISO();
  const updated = (await db.orm.public.PromptComponent.where({ id: componentId }).update({
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(contract !== undefined ? { contract: contract as any } : {}),
    updatedAt: now,
  })) as ComponentRow;
  return toComponentDto(updated);
}

/** Readable = own library component or a read-only system (owner-null) component. */
async function loadReadableComponent(userId: string, componentId: string): Promise<ComponentRow> {
  const row = await loadComponentRow(componentId);
  if (!row || (row.ownerId !== null && row.ownerId !== userId)) {
    throw new PromptError("Component not found", "NOT_FOUND", 404);
  }
  return row;
}

/**
 * Portable export (STO-1275): component data only — no ids, owner, novel,
 * timestamps or account data. A persisted contract that no longer validates is
 * rejected rather than silently dropped.
 */
export async function exportComponent(
  userId: string,
  componentId: string,
): Promise<PortablePromptComponentEnvelope> {
  const row = await loadReadableComponent(userId, componentId);
  return toPortableEnvelope({
    name: row.name,
    description: row.description,
    body: row.body,
    role: row.role,
    contract: normalizePromptContract(row.contract),
  });
}

/**
 * Portable import (STO-1275): validates the envelope and always creates a NEW
 * component owned by the importing user. Never overwrites by id/name and never
 * creates owner-null/system components.
 */
export async function importComponent(userId: string, raw: unknown): Promise<PromptComponentDto> {
  const component = parsePortableEnvelope(raw);
  return createComponent(userId, {
    name: component.name,
    description: component.description,
    body: component.body,
    role: component.role,
    contract: component.contract,
  });
}

export async function softDeleteComponent(userId: string, componentId: string): Promise<void> {
  const row = await loadComponentRow(componentId);
  if (!row) throw new PromptError("Component not found", "NOT_FOUND", 404);
  if (row.ownerId === null) {
    throw new PromptError("SYSTEM_DEFAULT components are read-only", "READ_ONLY", 403);
  }
  if (row.ownerId !== userId) {
    throw new PromptError("Component not found", "NOT_FOUND", 404);
  }
  const now = Temporal.Now.plainDateTimeISO();
  await db.orm.public.PromptComponent.where({ id: componentId }).update({
    deletedAt: now,
    updatedAt: now,
  });
}

/**
 * Resolve the active prompt for a mode:
 * novel active → user default → SYSTEM_DEFAULT.
 */
export async function resolvePromptForMode(
  userId: string,
  mode: GenerationMode | string,
  novelId: string | null,
): Promise<PromptDto> {
  await ensureSystemDefaultPrompts();
  assertMode(mode);

  if (novelId) {
    const novelRows = (await db.orm.public.Prompt.where((p) => p.deletedAt.isNull())
      .where((p) => p.scope.eq("NOVEL"))
      .where((p) => p.novelId.eq(novelId))
      .where((p) => p.mode.eq(mode))
      .where((p) => p.isActive.eq(true))
      .all()) as PromptRow[];
    const owned = novelRows.filter((r) => r.ownerId === userId);
    if (owned.length) {
      owned.sort((a, b) => a.position - b.position);
      return getPrompt(userId, owned[0].id);
    }
  }

  const userRows = (await db.orm.public.Prompt.where((p) => p.deletedAt.isNull())
    .where((p) => p.scope.eq("USER"))
    .where((p) => p.ownerId.eq(userId))
    .where((p) => p.mode.eq(mode))
    .where((p) => p.isActive.eq(true))
    .all()) as PromptRow[];
  if (userRows.length) {
    userRows.sort((a, b) => a.position - b.position);
    return getPrompt(userId, userRows[0].id);
  }

  const systemRows = (await db.orm.public.Prompt.where((p) => p.deletedAt.isNull())
    .where((p) => p.scope.eq("SYSTEM_DEFAULT"))
    .where((p) => p.mode.eq(mode))
    .where((p) => p.isActive.eq(true))
    .all()) as PromptRow[];
  if (!systemRows.length) {
    throw new PromptError(`No prompt available for mode '${mode}'`, "NOT_FOUND", 404);
  }
  systemRows.sort((a, b) => a.position - b.position);
  return getPrompt(userId, systemRows[0].id);
}

export interface ResolvedRender extends RenderedPrompt {
  prompt: PromptDto;
}

/** Load resolved prompt parts and render with scene bindings (Preview + Generate). */
export async function renderResolvedScenePrompt(
  userId: string,
  novelId: string | null,
  input: ScenePromptBindingInput,
): Promise<ResolvedRender> {
  const prompt = await resolvePromptForMode(userId, input.mode, novelId);
  const row = await loadPromptRow(prompt.id);
  if (!row) throw new PromptError("Prompt not found", "NOT_FOUND", 404);
  const parts = await loadEnabledParts(row.id, row.role, row.body);
  const rendered = renderPrompt(parts, buildSceneBindings(input));
  return { ...rendered, prompt };
}
