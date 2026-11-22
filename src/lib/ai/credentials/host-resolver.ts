/**
 * DNS resolution for BYOK baseUrl hosts (STO-1159 SSRF guard).
 *
 * Uses `node:dns` `resolve4`/`resolve6`, which work in Node and on Cloudflare
 * Workers (DNS over HTTPS via 1.1.1.1). `lookup` is not used because Workers
 * does not implement it.
 */

import { promises as dns } from "node:dns";

/** Resolves a hostname to every A/AAAA address it currently points at. */
export type HostResolver = (hostname: string) => Promise<string[]>;

const NO_RECORD_CODES = new Set(["ENODATA", "ENOTFOUND", "ENOTIMP", "ENONAME"]);

function isNoRecordError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && NO_RECORD_CODES.has(code);
}

/**
 * Default resolver: queries A and AAAA records. A family with no records is
 * treated as empty; any other DNS failure is rethrown so callers fail closed.
 */
export const defaultHostResolver: HostResolver = async (hostname) => {
  const [v4, v6] = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
  const addresses: string[] = [];
  for (const result of [v4, v6]) {
    if (result.status === "fulfilled") {
      addresses.push(...result.value);
    } else if (!isNoRecordError(result.reason)) {
      throw result.reason;
    }
  }
  return addresses;
};
