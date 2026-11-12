import { handleCodexApiError } from "@/lib/codex/errors";
import { getUserId } from "@/lib/codex/interchange/http";
import { getInterchangeMatrix } from "@/lib/codex/interchange/matrix";

export const dynamic = "force-dynamic";

/**
 * GET → the agreed V1 interchange variant matrix and policy (STO-1261).
 * Read-only; intended for the future import/export dialog.
 */
export async function GET() {
  try {
    const userId = await getUserId();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json(getInterchangeMatrix());
  } catch (err) {
    return handleCodexApiError(err);
  }
}
