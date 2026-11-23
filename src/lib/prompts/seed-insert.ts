/**
 * Runs a seed insert that may race with another caller doing the same insert
 * (STO-1289). Concurrent `ensureSystemDefaultPrompts()` calls can both see a
 * missing row and both try to create it; the loser hits a unique/primary key
 * violation (Postgres SQLSTATE `23505`). When the insert fails with that
 * conflict and `exists` then finds the row, another caller won the race and
 * the failure is swallowed. Any other error is rethrown, even if a row with
 * that id is already present.
 */
export async function insertSeedRow(
  insert: () => Promise<unknown>,
  exists: () => Promise<boolean>,
): Promise<void> {
  try {
    await insert();
  } catch (err) {
    if (!isUniqueViolation(err) || !(await exists())) {
      throw err;
    }
  }
}

/** Postgres unique_violation, or Prisma's classic unique-constraint code. */
function isUniqueViolation(err: unknown): boolean {
  for (let current: unknown = err; current != null;) {
    if (typeof current !== "object") {
      break;
    }
    const code = "code" in current ? current.code : undefined;
    if (code === "23505" || code === "P2002") {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
