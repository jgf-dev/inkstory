/**
 * Runs a seed insert that may race with another caller doing the same insert
 * (STO-1289). Concurrent `ensureSystemDefaultPrompts()` calls can both see a
 * missing row and both try to create it; the loser hits a unique/primary key
 * violation. When the insert fails, `exists` is checked: if the row is now
 * present another caller won the race and the failure is swallowed, otherwise
 * the original error is rethrown.
 */
export async function insertSeedRow(
  insert: () => Promise<unknown>,
  exists: () => Promise<boolean>,
): Promise<void> {
  try {
    await insert();
  } catch (err) {
    if (!(await exists())) {
      throw err;
    }
  }
}
