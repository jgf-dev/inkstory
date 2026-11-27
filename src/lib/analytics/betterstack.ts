/**
 * Better Stack browser analytics tag builder.
 *
 * Keeps the public browser token configurable via environment bindings,
 * suppresses telemetry in development/test/E2E runs, and distinguishes
 * production domains from Cloudflare preview deployments at runtime even
 * though both are built with `NODE_ENV="production"`.
 */

const BETTERSTACK_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export const PRODUCTION_ANALYTICS_HOSTNAMES = ["syncodex.xyz", "www.syncodex.xyz"] as const;

export interface BetterStackConfig {
  token?: string;
  environment?: string;
  nodeEnv?: string;
  isE2e?: boolean;
}

/**
 * JSON-encodes a string for safe embedding inside an inline HTML `<script>`
 * block, preventing `</script>` / `<!--` breakouts and JS line-separator errors.
 */
function serializeForInlineScript(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function buildHostnameEnvironmentExpression(): string {
  const prodCheck = PRODUCTION_ANALYTICS_HOSTNAMES.map(
    (host) => `location.hostname===${serializeForInlineScript(host)}`,
  ).join("||");

  return `(${prodCheck}?'production':location.hostname==='localhost'||location.hostname==='127.0.0.1'?'development':'preview')`;
}

/**
 * Builds the inline Better Stack bootstrap script, or returns `null` when
 * analytics should not be injected (non-production, E2E, or missing/invalid token).
 */
export function buildBetterStackInitScript(config: BetterStackConfig): string | null {
  if (config.nodeEnv !== "production" || config.isE2e) {
    return null;
  }

  const token = config.token?.trim();
  if (!token || !BETTERSTACK_TOKEN_PATTERN.test(token)) {
    return null;
  }

  const explicitEnv = config.environment?.trim();
  const environmentExpr = explicitEnv
    ? serializeForInlineScript(explicitEnv)
    : buildHostnameEnvironmentExpression();

  return [
    "!function(b,e,t,r){",
    "b[t]=b[t]||function(...args){(b[t].q=b[t].q||[]).push(args)};",
    "b[t].l=+new Date;",
    "var s=e.createElement('script');s.async=1;s.crossOrigin='anonymous';",
    "s.src='https://betterstack.net/b.js?t='+r;",
    "(e.head||e.getElementsByTagName('head')[0]).appendChild(s);",
    `}(window,document,'betterstack',${serializeForInlineScript(token)});`,
    `betterstack('init',{environment:${environmentExpr}});`,
  ].join("");
}
