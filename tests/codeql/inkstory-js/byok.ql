/**
 * @name BYOK credential material exposure
 * @description Tracks encrypted payload fields or decrypted BYOK secrets flowing to HTTP responses or logs.
 * @kind path-problem
 * @problem.severity error
 * @security-severity 8.5
 * @id inkstory/byok-secret-exposure
 */

import javascript

module ByokSecretLeakConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node source) {
    // Property reads of encrypted BYOK columns/fields
    exists(DataFlow::PropRead read |
      read = source and
      read.getPropertyName() = ["ciphertext", "iv", "authTag"]
    )
    or
    // Return value of decryptSecret(...)
    exists(DataFlow::CallNode call |
      call = source and
      call.getCalleeName() = "decryptSecret"
    )
  }

  predicate isSink(DataFlow::Node sink) {
    // Response.json(...) or NextResponse.json(...)
    exists(DataFlow::CallNode jsonResp |
      (
        jsonResp = DataFlow::globalVarRef("Response").getAMemberCall("json") or
        jsonResp = API::moduleImport("next/server").getMember("NextResponse").getMember("json").getACall()
      ) and
      sink = jsonResp.getArgument(0)
    )
    or
    // console.log / info / warn / error / debug
    exists(DataFlow::CallNode logCall |
      logCall = DataFlow::globalVarRef("console").getAMemberCall(["log", "info", "warn", "error", "debug"]) and
      sink = logCall.getAnArgument()
    )
  }
}

module ByokSecretLeakFlow = TaintTracking::Global<ByokSecretLeakConfig>;
import ByokSecretLeakFlow::PathGraph

from ByokSecretLeakFlow::PathNode source, ByokSecretLeakFlow::PathNode sink
where ByokSecretLeakFlow::flowPath(source, sink)
select sink.getNode(), source, sink, "BYOK secret material from $@ may be exposed here.",
  source.getNode(), "sensitive source"
