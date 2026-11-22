/**
 * Middleware-side Supabase helper. Refreshes the user's session cookie on
 * each request and forwards any refreshed cookies to the downstream response.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./types";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function updateSession(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (
    (pathname === "/" || pathname === "/dashboard") &&
    (searchParams.has("code") || (searchParams.has("token_hash") && searchParams.has("type")))
  ) {
    const callbackUrl = new URL(request.nextUrl.toString());
    callbackUrl.pathname = "/auth/callback";
    if (!callbackUrl.searchParams.has("next")) {
      callbackUrl.searchParams.set("next", "/dashboard");
    }
    return NextResponse.redirect(callbackUrl);
  }

  let response = NextResponse.next({ request });

  if (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_E2E === "true" &&
    request.cookies.get("e2e-user")
  ) {
    return response;
  }

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touch the session — this triggers a refresh if the access token is expiring.
  await supabase.auth.getUser();

  return response;
}
