import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createComponent,
  handlePromptApiError,
  listComponents,
  type CreateComponentInput,
} from "@/lib/prompts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const components = await listComponents(user.id);
    return Response.json({ components });
  } catch (err) {
    return handlePromptApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await request.json()) as CreateComponentInput;
    const component = await createComponent(user.id, body);
    return Response.json({ component }, { status: 201 });
  } catch (err) {
    return handlePromptApiError(err);
  }
}
