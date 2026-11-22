# Billing, Plans & Entitlements (`src/lib/billing`)

## Purpose

Subscription tier definitions, quota enforcement guards, and idempotent Stripe webhook synchronization onto `User` rows (paired with `src/lib/stripe.ts`).

## Modules

| Module                 | Role                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `plans.ts`             | `PlanTier` (`FREE`, `PRO`, `STUDIO`), `PLANS` limits, `PLAN_PRICING`, and `tierForPriceId` env mapper                                 |
| `entitlements.ts`      | `getPlanTierForUser`, `getEntitlements`, `ensureNovelQuota`, `ensureCodexEntryQuota`, and `resolveContextTokenBudget`                 |
| `subscription-sync.ts` | `User` subscription state writer (`applySubscriptionToUser`, `downgradeToFree`) and `StripeWebhookEvent` claim/mark/release lifecycle |

## Public Contracts & Invariants

- **Plan Tiers (`plans.ts`)**:
  - `FREE`: `1` novel, `30` Codex entries, `4000` context tokens, no series sharing.
  - `PRO` (`$15/mo` or `$144/yr`): unlimited novels and entries, `6000` context tokens, no series sharing.
  - `STUDIO` (`$35/mo` monthly-only): unlimited novels and entries, `6000` context tokens, series sharing enabled.
- **Entitlement Enforcement**: `entitlements.ts` reads `User.planTier` directly (no per-request Stripe API call). Exceeding limits throws `CodexError(..., "QUOTA_EXCEEDED", 402)`. `resolveContextTokenBudget` clamps requested token budgets to the user's tier ceiling.
- **Idempotent Webhooks**: `/api/billing/webhook` verifies `stripe-signature`, claims the event row in `StripeWebhookEvent` (`eventId` unique) _before_ applying subscription state, returns `200` for already-processed duplicates, returns `409` while another delivery is in flight, and releases the claim on error (`500`) so Stripe retries cleanly. Lapsed statuses (`canceled`, `unpaid`, `incomplete_expired`) downgrade to `FREE`.
- **Unconfigured Degradation**: When `STRIPE_SECRET_KEY` (or `STRIPE_WEBHOOK_SECRET` for webhooks) is unset, billing routes return `503 BILLING_NOT_CONFIGURED`.

## Environment Variables & API Routes

- **Env Vars**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`, `STRIPE_PRICE_STUDIO_MONTHLY`, `NEXT_PUBLIC_APP_URL`.
- **Routes**: `POST /api/billing/checkout`, `POST /api/billing/portal`, `POST /api/billing/webhook`.

## Verification

- **Unit (`bun run test:no-db`)**: `tests/billing-plans.test.ts`, `tests/stripe-client.test.ts`, `tests/pricing-table.test.ts`.
- **DB Integration (`bun run test`)**: `tests/billing-entitlements.test.ts`, `tests/billing-api.test.ts`.
