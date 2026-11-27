/**
 * @name Unsupported dns.lookup in Cloudflare Workers
 * @description Cloudflare Workers does not implement node:dns lookup; use resolve4/resolve6 instead.
 * @kind problem
 * @problem.severity error
 * @id inkstory/cloudflare-ban-dns-lookup
 */

import javascript

API::Node dnsModule() {
  result = API::moduleImport(["dns", "node:dns", "dns/promises", "node:dns/promises"])
  or
  result = API::moduleImport(["dns", "node:dns"]).getMember("promises")
}

from DataFlow::CallNode call
where call = dnsModule().getMember("lookup").getACall()
select call, "Avoid dns.lookup on Cloudflare Workers; use dns.resolve4 / dns.resolve6 instead."
