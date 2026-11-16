import { handleCodexApiError } from "@/lib/codex/errors";
import { getUserId } from "@/lib/codex/interchange/http";
import { listCraftTools, toCraftToolDto } from "@/lib/craft";

export const dynamic = "force-dynamic";

/**
 * GET /api/craft/tools → the code-owned Craft Studio tools (STO-1266): each
 * tool's contract (inputs, context slices, output behavior) and input defaults,
 * so the editor can render its form without hardcoding the contract.
 */
export async function GET() {
  try {
    const userId = await getUserId();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ tools: listCraftTools().map(toCraftToolDto) });
  } catch (err) {
    return handleCodexApiError(err);
  }
}
