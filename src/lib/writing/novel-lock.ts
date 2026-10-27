import { db, type DbClient } from "@/lib/prisma";

/** A transaction handle, as passed to the `db.transaction` callback. */
export type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/**
 * Advisory-lock key shared by every transaction that writes act, chapter or
 * scene positions in a novel (import confirm, manual create and reorder).
 * Keep it in one place so the writers can't drift onto different keys.
 */
export function novelStructureLockKey(novelId: string): string {
  return `novel-import:${novelId}`;
}

/**
 * Takes the novel's structure lock for the rest of the transaction. It must be
 * the first statement, and positions must only be read after it returns, so a
 * concurrent writer's rows are already committed and visible.
 */
export async function lockNovelStructure(tx: DbTransaction, novelId: string): Promise<void> {
  await tx.execute(
    db.raw.sql`SELECT pg_advisory_xact_lock(hashtext(${novelStructureLockKey(novelId)}))`
      .affectedCount()
      .build(),
  );
}
