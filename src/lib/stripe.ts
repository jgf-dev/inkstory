/**
 * Stripe client factory (STO-1180).
 *
 * The client is constructed lazily from `STRIPE_SECRET_KEY`. Billing routes
 * check `isStripeConfigured()` first and answer 503 when the deployment has
 * no keys, so the app runs (billing disabled) in development and CI.
 *
 * Never hard-code or log keys; they are read from the environment only.
 * Test mode keys are expected until the founder rotates live keys.
 */

import Stripe from "stripe";

let client: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function isWebhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY) && Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

/**
 * Returns the shared Stripe client.
 *
 * @throws when `STRIPE_SECRET_KEY` is unset; callers should gate on
 *   {@link isStripeConfigured} (or {@link isWebhookConfigured} for webhooks)
 *   and surface a 503 instead of leaking this error.
 */
export function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  if (!client) {
    client = new Stripe(secretKey);
  }
  return client;
}

/** Base URL used for Stripe redirect URLs (checkout success/cancel, portal return). */
export function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
