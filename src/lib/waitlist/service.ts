/**
 * Waitlist storage. Signups live in `public.waitlist_signups`; the unique
 * email constraint makes a repeat signup a silent no-op.
 */
import { db } from "@/lib/prisma";
import type { WaitlistSignupInput } from "./validation";

/**
 * Stores a signup unless the email is already on the list. Returns true when a
 * new row was inserted. Callers must not reveal this to the visitor.
 */
export async function addWaitlistSignup(signup: WaitlistSignupInput): Promise<boolean> {
  const inserted = await db.orm.public.WaitlistSignup.createAndCount(
    [{ email: signup.email, source: signup.source, referrer: signup.referrer }],
    { onConflict: "skip", conflictOn: ["email"] },
  );
  return inserted > 0;
}
