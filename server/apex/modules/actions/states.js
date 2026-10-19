// Action lifecycle (all transitions are compare-and-set in the repository):
//
//  PENDING_REVIEW --approve--> APPROVED --claim--> EXECUTING --ok------> EXECUTED
//        |                                            |  \--4xx-------> FAILED  --retry--> EXECUTING
//        \--reject--> REJECTED                        \--timeout/5xx--> UNKNOWN --retry--> EXECUTING
//
// FAILED  = the external system definitively did NOT accept it.
// UNKNOWN = outcome uncertain (timeout / 5xx / network). Retrying re-sends the SAME
//           idempotency key, so the external system de-duplicates.
const STATUS = Object.freeze({
  PENDING_REVIEW: "PENDING_REVIEW", APPROVED: "APPROVED", REJECTED: "REJECTED",
  EXECUTING: "EXECUTING", EXECUTED: "EXECUTED", FAILED: "FAILED", UNKNOWN: "UNKNOWN",
});
module.exports = { STATUS };
