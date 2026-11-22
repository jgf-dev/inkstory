# AI Generation, BYOK & Capabilities (`src/lib/ai`)

## Purpose

Scene prose generation via the platform Vercel AI Gateway, encrypted BYOK provider management, vendor-neutral LLM adapters, and server-resolved model capability gating.

## Modules

| Module                                                                                                   | Role                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `generate.ts`                                                                                            | Platform AI Gateway client (`generateText`), `AiError`, `handleAiApiError`, `MAX_OUTPUT_TOKENS` (`4096`), `DEFAULT_MAX_OUTPUT_TOKENS` (`1024`) |
| `execute.ts`                                                                                             | Shared chat execution (`executeChat`) for `/api/ai/generate` and `/api/craft/[tool]`                                                           |
| `providers/{types,index,http,openai-compatible,openrouter,openai,anthropic,ollama,lmstudio,advanced}.ts` | `LlmProvider` interface, `createProvider` factory, HTTP transport with secret redaction (`redactSecret`), and 5 provider adapters              |
| `credentials/{index,service,crypto,host-resolver,auth}.ts`                                               | AES-256-GCM credential encryption, Workers-compatible SSRF host resolution, and CRUD service                                                   |
| `capabilities/{index,types,registry,openrouter-catalog,resolve,guidance,validate,applied,display}.ts`    | Server-side capability resolution, OpenRouter catalog cache, and advanced control validation (`minP`, `avoidanceGuidance`, `endpoint`)         |

## Public Contracts & Invariants

- **Zero-Spend Fallback**: When `AI_GATEWAY_API_KEY` is unset and no `credentialId` is supplied, `generateText` throws `AiError(..., "AI_NOT_CONFIGURED", 503)` and `/api/ai/generate` still returns the assembled prompt for manual copy/paste.
- **No BYOK Fallback to Platform Spend**: Explicit BYOK execution (`credentialId` + `model` via `executeChat`) must never fall back to the platform gateway if the BYOK call fails.
- **Credential Encryption & DTO Hygiene**: Keys are encrypted with AES-256-GCM (`credentials/crypto.ts`) using a 32-byte canonical base64 `BYOK_ENCRYPTION_KEY` and 12-byte IV. API DTOs expose only `keyHint` (last 4 chars) and `hasKey` — never `ciphertext`, `iv`, `authTag`, or plaintext keys (`assertNoSecretFields`).
- **Workers-Safe SSRF Guard**: `credentials/host-resolver.ts` uses `node:dns` `resolve4`/`resolve6` (DNS over HTTPS; never `dns.lookup`, which Cloudflare Workers omits) and fails closed on non-record DNS errors.
- **Provider Registry**: Supports `openrouter`, `openai`, `anthropic`, `ollama`, and `lmstudio`. Local providers (`ollama`, `lmstudio`) do not require an API key (`isLocalProvider`).
- **Server-Resolved Capabilities**: `capabilities/` validates `minP`, instruction-only `avoidanceGuidance`, and OpenRouter `endpoint` slugs server-side; client capability maps are ignored.

## Environment Variables & API Routes

- **Env Vars**: `AI_GATEWAY_API_KEY`, `AI_GATEWAY_BASE_URL` (default `https://ai-gateway.vercel.sh/v1`), `AI_MODEL` (default `anthropic/claude-sonnet-4.6`), `BYOK_ENCRYPTION_KEY`.
- **Routes**: `POST /api/ai/generate`, `POST /api/ai/preview`, `GET /api/ai/capabilities`, `GET|PUT /api/ai/credentials`, `GET|PATCH|DELETE /api/ai/credentials/[id]`.

## Verification

- **Unit (`bun run test:no-db`)**: `tests/ai-generate.test.ts`, `tests/ai-generate-byok-resolution.test.ts`, `tests/ai-generate-capabilities.test.ts`, `tests/ai-providers.test.ts`, `tests/ai-providers-advanced.test.ts`, `tests/ai-capabilities.test.ts`, `tests/ai-credentials-{crypto,base-url,dns}.test.ts`.
- **DB Integration (`bun run test`)**: `tests/ai-credentials-service.test.ts`, `tests/ai-credentials-api.test.ts`.
