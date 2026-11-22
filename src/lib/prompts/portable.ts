/**
 * Portable Prompt Component JSON (STO-1275).
 *
 * Data-only interchange envelope:
 *   { format: "inkstory.prompt-component", formatVersion: 1,
 *     component: { name, description, body, role, contract } }
 *
 * Export carries component data only — never ids, ownerId, novelId, account
 * emails, timestamps, credentials, provider URLs or linked novel text. Import
 * validates strictly (unknown fields and versions are rejected, never silently
 * stripped) and always creates a NEW component owned by the importing user.
 */

import { VARIABLE_PATTERN, isPromptVariableToken } from "./catalog";
import {
  CRAFT_INPUT_KEYS,
  normalizePromptContract,
  type ContextSlice,
  type ContractAttribution,
  type ContractOutput,
  type PromptComponentContract,
} from "./contracts";
import { PromptError } from "./errors";
import type { PromptComponentDto, PromptRoleName } from "./types";

export const PORTABLE_COMPONENT_FORMAT = "inkstory.prompt-component" as const;
export const PORTABLE_COMPONENT_FORMAT_VERSION = 1 as const;
/** Whole-file cap for import requests (the contract itself is capped at 64 KiB). */
export const PORTABLE_COMPONENT_MAX_BYTES = 256 * 1024;

export interface PortablePromptComponent {
  name: string;
  description: string | null;
  body: string;
  role: PromptRoleName;
  contract: PromptComponentContract | null;
}

export interface PortablePromptComponentEnvelope {
  format: typeof PORTABLE_COMPONENT_FORMAT;
  formatVersion: typeof PORTABLE_COMPONENT_FORMAT_VERSION;
  component: PortablePromptComponent;
}

export interface PortableImportPreview {
  component: PortablePromptComponent;
  features: {
    inputs: Array<{ key: string; type: string; required: boolean }>;
    contextSlices: ContextSlice[];
    output: ContractOutput | null;
    attribution: ContractAttribution | null;
  };
  bodyTokens: {
    /** Closed-catalog scene tokens ({{scene.title}} …). */
    catalog: string[];
    /** Registered craft input tokens ({{craft.selection}} …). */
    craftInputs: string[];
    /** Anything else; left as literal text at render time. */
    unknown: string[];
  };
  warnings: string[];
}

const ENVELOPE_FIELDS = ["format", "formatVersion", "component"] as const;
const COMPONENT_FIELDS = ["name", "description", "body", "role", "contract"] as const;
const ROLES: readonly PromptRoleName[] = ["SYSTEM", "USER"];

function invalidPortable(message: string): PromptError {
  return new PromptError(`Invalid prompt component file: ${message}`, "INVALID_PORTABLE", 422);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Builds an export envelope from component data only (explicit allowlist). */
export function toPortableEnvelope(
  component: Pick<PromptComponentDto, "name" | "description" | "body" | "role" | "contract">,
): PortablePromptComponentEnvelope {
  return {
    format: PORTABLE_COMPONENT_FORMAT,
    formatVersion: PORTABLE_COMPONENT_FORMAT_VERSION,
    component: {
      name: component.name,
      description: component.description ?? null,
      body: component.body,
      role: component.role,
      contract: component.contract ?? null,
    },
  };
}

/** Validates a parsed envelope and returns canonical component data. */
export function parsePortableEnvelope(raw: unknown): PortablePromptComponent {
  if (!isPlainObject(raw)) throw invalidPortable("expected a JSON object");
  if (raw.format !== PORTABLE_COMPONENT_FORMAT) {
    throw invalidPortable(`format must be "${PORTABLE_COMPONENT_FORMAT}"`);
  }
  const version = raw.formatVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw invalidPortable("formatVersion must be a positive integer");
  }
  if (version !== PORTABLE_COMPONENT_FORMAT_VERSION) {
    throw new PromptError(
      `Unsupported ${PORTABLE_COMPONENT_FORMAT} formatVersion ${version}; this version of InkStory supports formatVersion ${PORTABLE_COMPONENT_FORMAT_VERSION}`,
      "UNSUPPORTED_VERSION",
      422,
    );
  }
  for (const key of Object.keys(raw)) {
    if (!(ENVELOPE_FIELDS as readonly string[]).includes(key)) {
      throw invalidPortable(`unsupported top-level field "${key}"`);
    }
  }

  const component = raw.component;
  if (!isPlainObject(component)) throw invalidPortable("component must be an object");
  for (const key of Object.keys(component)) {
    if (!(COMPONENT_FIELDS as readonly string[]).includes(key)) {
      throw invalidPortable(
        `component.${key} is not allowed; portable files carry component data only (no ids, ownership, scope or timestamps)`,
      );
    }
  }

  const name = typeof component.name === "string" ? component.name.trim() : "";
  if (!name) throw invalidPortable("component.name is required");
  if (typeof component.body !== "string") throw invalidPortable("component.body must be a string");
  const description = component.description ?? null;
  if (description !== null && typeof description !== "string") {
    throw invalidPortable("component.description must be a string or null");
  }
  const role = component.role ?? "SYSTEM";
  if (!ROLES.includes(role as PromptRoleName)) {
    throw invalidPortable(`component.role must be one of: ${ROLES.join(", ")}`);
  }

  return {
    name,
    description,
    body: component.body,
    role: role as PromptRoleName,
    contract: normalizePromptContract(component.contract),
  };
}

/** Size-checks and JSON-parses raw request text (SyntaxError → INVALID_JSON upstream). */
export function readPortableJson(text: string): unknown {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > PORTABLE_COMPONENT_MAX_BYTES) {
    throw new PromptError(
      `Prompt component file is ${bytes} bytes; the maximum is ${PORTABLE_COMPONENT_MAX_BYTES} bytes`,
      "PAYLOAD_TOO_LARGE",
      413,
    );
  }
  return JSON.parse(text) as unknown;
}

/** Size-checks, parses and validates raw request text. */
export function parsePortableText(text: string): PortablePromptComponent {
  return parsePortableEnvelope(readPortableJson(text));
}

/** Lists `{{…}}` tokens in a body, grouped by how the renderer will treat them. */
export function classifyBodyTokens(body: string): PortableImportPreview["bodyTokens"] {
  const catalog = new Set<string>();
  const craftInputs = new Set<string>();
  const unknown = new Set<string>();
  for (const match of body.matchAll(VARIABLE_PATTERN)) {
    const token = match[1];
    if (isPromptVariableToken(token)) catalog.add(token);
    else if ((CRAFT_INPUT_KEYS as readonly string[]).includes(token)) craftInputs.add(token);
    else unknown.add(token);
  }
  return { catalog: [...catalog], craftInputs: [...craftInputs], unknown: [...unknown] };
}

/** Preview of supported features and warnings before an explicit save. */
export function previewPortableComponent(
  component: PortablePromptComponent,
): PortableImportPreview {
  const contract = component.contract;
  const bodyTokens = classifyBodyTokens(component.body);
  const declared = new Set<string>(contract?.inputs.map((input) => input.key) ?? []);
  const warnings: string[] = [];

  for (const token of bodyTokens.craftInputs) {
    if (!declared.has(token)) {
      warnings.push(
        `{{${token}}} is used in the body but not declared as a contract input; it will be left as literal text`,
      );
    }
  }
  for (const token of bodyTokens.unknown) {
    warnings.push(`{{${token}}} is not a supported variable; it will be left as literal text`);
  }
  for (const key of declared) {
    if (!bodyTokens.craftInputs.includes(key)) {
      warnings.push(`Declared input ${key} is not referenced in the body`);
    }
  }

  return {
    component,
    features: {
      inputs: (contract?.inputs ?? []).map(({ key, type, required }) => ({ key, type, required })),
      contextSlices: contract?.contextSlices ?? [],
      output: contract?.output ?? null,
      attribution: contract?.attribution ?? null,
    },
    bodyTokens,
    warnings,
  };
}
