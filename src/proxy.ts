/**
 * Next.js middleware — refreshes the Supabase session cookie on every request.
 *
 * Without this, server components will see a stale session and read auth as
 * anonymous. Must use the same @supabase/ssr helpers as the server client.
 */
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
