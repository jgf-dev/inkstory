/**
 * Lightweight liveness probe. Returns 200 + a JSON descriptor of the runtime.
 * Useful for CI / Vercel health checks; does not require DB access.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    status: "ok",
    service: "inkstory",
    version: process.env.npm_package_version ?? "0.1.0",
    time: new Date().toISOString(),
  });
}
