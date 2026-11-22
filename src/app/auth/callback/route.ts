import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ALLOWED_OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function resolveSafeRedirectUrl(rawNext: string | null, origin: string): URL {
  const fallback = new URL("/dashboard", origin);
  if (!rawNext || !rawNext.startsWith("/") || hasControlCharacters(rawNext)) {
    return fallback;
  }

  try {
    const resolved = new URL(rawNext, origin);
    if (resolved.origin !== origin || resolved.pathname.startsWith("//")) {
      return fallback;
    }
    return resolved;
  } catch {
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const redirectUrl = resolveSafeRedirectUrl(url.searchParams.get("next"), url.origin);

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(redirectUrl);
    }
  } else if (tokenHash && type && ALLOWED_OTP_TYPES.has(type as EmailOtpType)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (!error) {
      return NextResponse.redirect(redirectUrl);
    }
  }

  return NextResponse.redirect(new URL("/login?error=confirmation_failed", url.origin));
}
