import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getClientIp, TURNSTILE_TOKEN_FIELD, verifyTurnstileToken } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

async function parseAuthPayload(
  request: NextRequest,
): Promise<{ email?: unknown; password?: unknown; [TURNSTILE_TOKEN_FIELD]?: unknown } | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const parsed: unknown = await request.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    try {
      const formData = await request.formData();
      return {
        email: formData.get("email") ?? undefined,
        password: formData.get("password") ?? undefined,
        [TURNSTILE_TOKEN_FIELD]: formData.get(TURNSTILE_TOKEN_FIELD) ?? undefined,
      };
    } catch {
      return null;
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  const body = await parseAuthPayload(request);
  if (!body) {
    return Response.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const verification = await verifyTurnstileToken({
    token: body[TURNSTILE_TOKEN_FIELD],
    expectedAction: "signup",
    remoteIp: getClientIp(request),
  });
  if (!verification.ok) {
    return Response.json(
      { error: "Security verification failed. Please try again." },
      { status: 403 },
    );
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || password.length < 6) {
    return Response.json(
      { error: "Valid email and password (minimum 6 characters) are required." },
      { status: 400 },
    );
  }

  const origin = new URL(request.url).origin;
  const supabase = await createSupabaseServerClient();
  const { data, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
    },
  });

  if (signUpError) {
    return Response.json({ error: signUpError.message }, { status: 400 });
  }

  return Response.json({
    ok: true,
    hasSession: Boolean(data.session),
  });
}
