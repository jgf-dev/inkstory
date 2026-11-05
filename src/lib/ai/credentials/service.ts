/**
 * BYOK credential CRUD + resolveProviderConfig (STO-1178).
 *
 * Ownership is enforced via ownerId. Soft-delete-safe uniqueness on
 * (ownerId, provider, label) is enforced in the service via an advisory
 * xact lock around find+insert/update (partial unique indexes parked for
 * STO-1168). Decrypt happens only here when building a ProviderConfig —
 * never in API response DTOs.
 */

import { Temporal } from "temporal-polyfill";
import { db } from "@/lib/prisma";
import {
  createProvider,
  isLocalProvider,
  type ProviderConfig,
  type ProviderId,
} from "@/lib/ai/providers";
import { ByokCryptoError, decryptSecret, encryptSecret, keyHintFrom } from "./crypto";

export type AiProviderName = "OPENROUTER" | "OPENAI" | "ANTHROPIC" | "OLLAMA" | "LMSTUDIO";

const PROVIDER_TO_ID: Record<AiProviderName, ProviderId> = {
  OPENROUTER: "openrouter",
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  OLLAMA: "ollama",
  LMSTUDIO: "lmstudio",
};

const ID_TO_PROVIDER: Record<ProviderId, AiProviderName> = {
  openrouter: "OPENROUTER",
  openai: "OPENAI",
  anthropic: "ANTHROPIC",
  ollama: "OLLAMA",
  lmstudio: "LMSTUDIO",
};

export const AI_PROVIDERS: readonly AiProviderName[] = [
  "OPENROUTER",
  "OPENAI",
  "ANTHROPIC",
  "OLLAMA",
  "LMSTUDIO",
];

export function isAiProviderName(value: unknown): value is AiProviderName {
  return typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);
}

export function providerIdFromName(name: AiProviderName): ProviderId {
  return PROVIDER_TO_ID[name];
}

export function providerNameFromId(id: ProviderId): AiProviderName {
  return ID_TO_PROVIDER[id];
}

export class CredentialError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "VALIDATION_FAILED"
      | "CONFLICT"
      | "CRYPTO_ERROR",
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "CredentialError";
  }
}

/** Safe DTO — never includes ciphertext, iv, authTag, or plaintext. */
export interface CredentialDto {
  id: string;
  provider: AiProviderName;
  label: string;
  keyHint: string | null;
  hasKey: boolean;
  baseUrl: string | null;
  updatedAt: string;
}

type CredentialRow = {
  id: string;
  ownerId: string;
  provider: AiProviderName;
  label: string;
  ciphertext: Uint8Array | null;
  iv: Uint8Array | null;
  authTag: Uint8Array | null;
  keyHint: string | null;
  keyVersion: number;
  baseUrl: string | null;
  defaultModel: string | null;
  defaultTemp: number | null;
  createdAt: Temporal.PlainDateTime;
  updatedAt: Temporal.PlainDateTime;
  deletedAt: Temporal.PlainDateTime | null;
};

function toDto(row: CredentialRow): CredentialDto {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    keyHint: row.keyHint,
    hasKey: row.ciphertext != null && row.iv != null && row.authTag != null,
    baseUrl: row.baseUrl,
    updatedAt: row.updatedAt.toString(),
  };
}

/** Assert a DTO (or any object) has no secret fields — used in tests + defense. */
export const SECRET_FIELD_NAMES = [
  "ciphertext",
  "iv",
  "authTag",
  "auth_tag",
  "plaintext",
  "apiKey",
  "api_key",
  "key",
] as const;

export function assertNoSecretFields(value: unknown, path = "root"): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoSecretFields(item, `${path}[${i}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if ((SECRET_FIELD_NAMES as readonly string[]).includes(k)) {
      throw new Error(`Secret field "${k}" leaked at ${path}`);
    }
    assertNoSecretFields(v, `${path}.${k}`);
  }
}

export function handleCredentialApiError(err: unknown): Response {
  if (err instanceof SyntaxError) {
    return Response.json(
      { error: "Malformed or invalid JSON body", code: "INVALID_JSON" },
      { status: 400 },
    );
  }
  if (err instanceof CredentialError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof ByokCryptoError) {
    const status = err.code === "KEY_MISSING" || err.code === "KEY_INVALID" ? 503 : 500;
    return Response.json(
      { error: "Credential encryption is not available", code: "CRYPTO_ERROR" },
      { status },
    );
  }
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

export function validateCredentialFields(body: Record<string, unknown>): string | null {
  if (body.label !== undefined && typeof body.label !== "string") {
    return "label must be a string";
  }
  if (body.apiKey !== undefined && body.apiKey !== null && typeof body.apiKey !== "string") {
    return "apiKey must be a string";
  }
  if (body.baseUrl !== undefined && body.baseUrl !== null && typeof body.baseUrl !== "string") {
    return "baseUrl must be a string";
  }
  return null;
}

export function parseCredentialInput(body: Record<string, unknown>): {
  label?: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  defaultModel?: string | null;
  defaultTemp?: number | null;
} {
  return {
    label: typeof body.label === "string" ? body.label : undefined,
    apiKey: typeof body.apiKey === "string" ? body.apiKey : body.apiKey === null ? null : undefined,
    baseUrl:
      typeof body.baseUrl === "string" ? body.baseUrl : body.baseUrl === null ? null : undefined,
    defaultModel:
      typeof body.defaultModel === "string"
        ? body.defaultModel
        : body.defaultModel === null
          ? null
          : undefined,
    defaultTemp:
      typeof body.defaultTemp === "number"
        ? body.defaultTemp
        : body.defaultTemp === null
          ? null
          : undefined,
  };
}

async function findActiveByOwnerProviderLabel(
  ownerId: string,
  provider: AiProviderName,
  label: string,
): Promise<CredentialRow | null> {
  const rows = await db.orm.public.UserProviderCredential.where((c) => c.ownerId.eq(ownerId))
    .where((c) => c.provider.eq(provider))
    .where((c) => c.label.eq(label))
    .where((c) => c.deletedAt.isNull())
    .all();
  return (rows[0] as CredentialRow | undefined) ?? null;
}

export async function listCredentials(ownerId: string): Promise<CredentialDto[]> {
  const rows = await db.orm.public.UserProviderCredential.where((c) => c.ownerId.eq(ownerId))
    .where((c) => c.deletedAt.isNull())
    .all();
  return (rows as CredentialRow[]).map(toDto);
}

export async function getCredential(ownerId: string, credentialId: string): Promise<CredentialDto> {
  const row = (await db.orm.public.UserProviderCredential.where({
    id: credentialId,
  }).first()) as CredentialRow | null;
  if (!row || row.deletedAt) {
    throw new CredentialError("Credential not found", "NOT_FOUND", 404);
  }
  if (row.ownerId !== ownerId) {
    throw new CredentialError("Credential not found", "NOT_FOUND", 404);
  }
  return toDto(row);
}

export interface UpsertCredentialInput {
  provider: AiProviderName;
  label?: string;
  /** Plaintext API key — encrypted before storage. Omit/empty for local keyless. */
  apiKey?: string | null;
  baseUrl?: string | null;
  defaultModel?: string | null;
  defaultTemp?: number | null;
}

function credentialUpsertLockKey(ownerId: string, provider: AiProviderName, label: string): string {
  return `byok-credential:${ownerId}:${provider}:${label}`;
}

function prepareEncryptedKey(apiKey: string): {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
  keyHint: string | null;
} {
  try {
    const enc = encryptSecret(apiKey);
    return {
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      keyHint: keyHintFrom(apiKey),
    };
  } catch (err) {
    if (err instanceof ByokCryptoError) throw err;
    throw new CredentialError("Failed to encrypt API key", "CRYPTO_ERROR", 500);
  }
}

export async function upsertCredential(
  ownerId: string,
  input: UpsertCredentialInput,
): Promise<CredentialDto> {
  if (!isAiProviderName(input.provider)) {
    throw new CredentialError("Invalid provider", "VALIDATION_FAILED", 400);
  }
  const label = (input.label ?? "default").trim() || "default";
  if (label.length > 64) {
    throw new CredentialError("label must be ≤ 64 characters", "VALIDATION_FAILED", 400);
  }

  const providerId = providerIdFromName(input.provider);
  const local = isLocalProvider(providerId);
  const apiKeyProvided = input.apiKey !== undefined;
  const apiKey = apiKeyProvided ? (input.apiKey?.trim() ?? "") : undefined;

  // Encrypt outside the lock so we hold the advisory lock briefly.
  let keyFields:
    | {
        ciphertext: Uint8Array | null;
        iv: Uint8Array | null;
        authTag: Uint8Array | null;
        keyHint: string | null;
        keyVersion: number;
      }
    | undefined;
  if (apiKeyProvided) {
    if (apiKey) {
      keyFields = { ...prepareEncryptedKey(apiKey), keyVersion: 1 };
    } else {
      keyFields = {
        ciphertext: null,
        iv: null,
        authTag: null,
        keyHint: null,
        keyVersion: 1,
      };
    }
  }

  const baseUrl =
    input.baseUrl === undefined
      ? undefined
      : input.baseUrl === null || input.baseUrl.trim() === ""
        ? null
        : input.baseUrl.trim();

  const now = Temporal.Now.plainDateTimeISO();

  // Soft-delete-safe uniqueness is parked for STO-1168; serialize concurrent
  // upserts for the same (owner, provider, label) with an advisory xact lock
  // (same pattern as novel structure writes).
  return db.transaction(async (tx) => {
    await tx.execute(
      db.raw
        .sql`SELECT pg_advisory_xact_lock(hashtext(${credentialUpsertLockKey(ownerId, input.provider, label)}))`
        .affectedCount()
        .build(),
    );

    const existingRows = await tx.orm.public.UserProviderCredential.where((c) =>
      c.ownerId.eq(ownerId),
    )
      .where((c) => c.provider.eq(input.provider))
      .where((c) => c.label.eq(label))
      .where((c) => c.deletedAt.isNull())
      .all();
    const existing = (existingRows[0] as CredentialRow | undefined) ?? null;

    if (existing) {
      if (apiKeyProvided) {
        if (!local && !apiKey) {
          throw new CredentialError(
            "apiKey cannot be cleared for this provider",
            "VALIDATION_FAILED",
            400,
          );
        }
      }

      const updated = (await tx.orm.public.UserProviderCredential.where({
        id: existing.id,
      }).update({
        ...keyFields,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(input.defaultModel !== undefined ? { defaultModel: input.defaultModel } : {}),
        ...(input.defaultTemp !== undefined ? { defaultTemp: input.defaultTemp } : {}),
        updatedAt: now,
      })) as CredentialRow;
      return toDto(updated);
    }

    if (!local && !apiKey) {
      throw new CredentialError("apiKey is required for this provider", "VALIDATION_FAILED", 400);
    }

    const created = (await tx.orm.public.UserProviderCredential.create({
      id: crypto.randomUUID(),
      ownerId,
      provider: input.provider,
      label,
      ciphertext: keyFields?.ciphertext ?? null,
      iv: keyFields?.iv ?? null,
      authTag: keyFields?.authTag ?? null,
      keyHint: keyFields?.keyHint ?? null,
      keyVersion: keyFields?.keyVersion ?? 1,
      baseUrl: baseUrl ?? null,
      defaultModel: input.defaultModel ?? null,
      defaultTemp: input.defaultTemp ?? null,
      updatedAt: now,
    })) as CredentialRow;

    return toDto(created);
  });
}

export interface PatchCredentialInput {
  label?: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  defaultModel?: string | null;
  defaultTemp?: number | null;
}

export async function patchCredential(
  ownerId: string,
  credentialId: string,
  input: PatchCredentialInput,
): Promise<CredentialDto> {
  const row = (await db.orm.public.UserProviderCredential.where({
    id: credentialId,
  }).first()) as CredentialRow | null;
  if (!row || row.deletedAt) {
    throw new CredentialError("Credential not found", "NOT_FOUND", 404);
  }
  if (row.ownerId !== ownerId) {
    throw new CredentialError("Credential not found", "NOT_FOUND", 404);
  }

  const updates: Record<string, unknown> = {
    updatedAt: Temporal.Now.plainDateTimeISO(),
  };

  if (input.label !== undefined) {
    const label = input.label.trim() || "default";
    if (label.length > 64) {
      throw new CredentialError("label must be ≤ 64 characters", "VALIDATION_FAILED", 400);
    }
    if (label !== row.label) {
      const clash = await findActiveByOwnerProviderLabel(ownerId, row.provider, label);
      if (clash && clash.id !== row.id) {
        throw new CredentialError(
          "A credential with this provider and label already exists",
          "CONFLICT",
          409,
        );
      }
      updates.label = label;
    }
  }

  if (input.apiKey !== undefined) {
    const apiKey = input.apiKey?.trim() ?? "";
    const providerId = providerIdFromName(row.provider);
    if (!isLocalProvider(providerId) && !apiKey) {
      throw new CredentialError(
        "apiKey cannot be cleared for this provider",
        "VALIDATION_FAILED",
        400,
      );
    }
    if (apiKey) {
      Object.assign(updates, prepareEncryptedKey(apiKey), { keyVersion: 1 });
    } else {
      updates.ciphertext = null;
      updates.iv = null;
      updates.authTag = null;
      updates.keyHint = null;
    }
  }

  if (input.baseUrl !== undefined) {
    updates.baseUrl =
      input.baseUrl === null || input.baseUrl.trim() === "" ? null : input.baseUrl.trim();
  }
  if (input.defaultModel !== undefined) {
    updates.defaultModel = input.defaultModel;
  }
  if (input.defaultTemp !== undefined) {
    updates.defaultTemp = input.defaultTemp;
  }

  const updated = (await db.orm.public.UserProviderCredential.where({
    id: credentialId,
  }).update(updates)) as CredentialRow;

  return toDto(updated);
}

export async function softDeleteCredential(
  ownerId: string,
  credentialId: string,
): Promise<{ id: string; deleted: true }> {
  const row = (await db.orm.public.UserProviderCredential.where({
    id: credentialId,
  }).first()) as CredentialRow | null;
  if (!row || row.deletedAt) {
    throw new CredentialError("Credential not found", "NOT_FOUND", 404);
  }
  if (row.ownerId !== ownerId) {
    throw new CredentialError("Credential not found", "NOT_FOUND", 404);
  }
  const now = Temporal.Now.plainDateTimeISO();
  await db.orm.public.UserProviderCredential.where({ id: credentialId }).update({
    deletedAt: now,
    updatedAt: now,
  });
  return { id: credentialId, deleted: true };
}

/**
 * Decrypt a credential owned by `ownerId` into a ProviderConfig.
 * Soft-deleted rows are not resolvable. Plaintext lives only in memory.
 */
export async function resolveProviderConfig(
  ownerId: string,
  credentialId: string,
): Promise<ProviderConfig> {
  const row = (await db.orm.public.UserProviderCredential.where({
    id: credentialId,
  }).first()) as CredentialRow | null;

  if (!row || row.deletedAt || row.ownerId !== ownerId) {
    throw new CredentialError("Credential not found", "NOT_FOUND", 404);
  }

  const providerId = providerIdFromName(row.provider);
  const baseUrl = row.baseUrl ?? undefined;
  let apiKey: string | undefined;

  if (row.ciphertext && row.iv && row.authTag) {
    apiKey = decryptSecret({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.authTag,
    });
  }

  switch (providerId) {
    case "openrouter":
      if (!apiKey) {
        throw new CredentialError("Credential has no API key", "VALIDATION_FAILED", 400);
      }
      return { provider: "openrouter", apiKey, baseUrl };
    case "openai":
      if (!apiKey) {
        throw new CredentialError("Credential has no API key", "VALIDATION_FAILED", 400);
      }
      return { provider: "openai", apiKey, baseUrl };
    case "anthropic":
      if (!apiKey) {
        throw new CredentialError("Credential has no API key", "VALIDATION_FAILED", 400);
      }
      return { provider: "anthropic", apiKey, baseUrl };
    case "ollama":
      return { provider: "ollama", apiKey, baseUrl };
    case "lmstudio":
      return { provider: "lmstudio", apiKey, baseUrl };
    default: {
      const _exhaustive: never = providerId;
      throw new CredentialError(
        `Unsupported provider: ${String(_exhaustive)}`,
        "VALIDATION_FAILED",
        400,
      );
    }
  }
}

/** Convenience: resolve + createProvider (plaintext never leaves this call). */
export async function createProviderFromCredential(ownerId: string, credentialId: string) {
  const config = await resolveProviderConfig(ownerId, credentialId);
  return createProvider(config);
}
