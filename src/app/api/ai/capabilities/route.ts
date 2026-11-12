import { NextRequest } from "next/server";
import {
  getAuthenticatedUser,
  getCredential,
  handleCredentialApiError,
  providerIdFromName,
} from "@/lib/ai/credentials";
import { resolveGatewayModel } from "@/lib/ai/generate";
import {
  CapabilityError,
  handleCapabilityApiError,
  parseAdvancedControls,
  resolveCapabilities,
  summarizeProfile,
} from "@/lib/ai/capabilities";
import { isCustomOpenRouterBaseUrl } from "@/lib/ai/providers";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/capabilities?credentialId=&model=&endpoint= (STO-1265)
 *
 * Server-resolved advanced-control capabilities for the selected route, used
 * to gate the AI drawer's advanced panel. No credential is decrypted and no
 * key, ciphertext, or base URL is returned. Omit `credentialId` for the
 * platform gateway.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = request.nextUrl.searchParams;
    const credentialId = params.get("credentialId")?.trim() || undefined;
    const model = params.get("model")?.trim() || undefined;
    const endpointRaw = params.get("endpoint") ?? undefined;
    const { endpoint } = parseAdvancedControls(
      endpointRaw !== undefined && endpointRaw.trim() ? { endpoint: endpointRaw } : {},
    );

    if (!credentialId) {
      if (model || endpoint) {
        return Response.json(
          {
            error: "model and endpoint can only be chosen with a saved credential",
            code: "VALIDATION_FAILED",
          },
          { status: 400 },
        );
      }
      const profile = await resolveCapabilities({
        provider: "platform-gateway",
        model: resolveGatewayModel(),
      });
      return Response.json({ capabilities: summarizeProfile(profile) });
    }

    if (credentialId.length > 128 || !model || model.length > 256) {
      return Response.json(
        {
          error: "BYOK requires a credentialId and provider-specific model (up to 256 characters)",
          code: "VALIDATION_FAILED",
        },
        { status: 400 },
      );
    }

    const credential = await getCredential(user.id, credentialId);
    const provider = providerIdFromName(credential.provider);
    const profile = await resolveCapabilities(
      {
        provider,
        model,
        endpoint,
        customBaseUrl: provider === "openrouter" && isCustomOpenRouterBaseUrl(credential.baseUrl),
      },
      { useCatalog: true, signal: request.signal },
    );
    return Response.json({ capabilities: summarizeProfile(profile) });
  } catch (err) {
    if (err instanceof CapabilityError) return handleCapabilityApiError(err);
    return handleCredentialApiError(err);
  }
}
