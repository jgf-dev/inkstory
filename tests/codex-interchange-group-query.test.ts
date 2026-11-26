import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { db } from "../src/lib/prisma";
import {
  findImportedGroupEntryIds,
  importLorebook,
  loadImportedGroupBookSources,
} from "../src/lib/codex/interchange/service";
import {
  CARD_FORMAT,
  INTERCHANGE_ENVELOPE_KEY,
  LOREBOOK_FORMAT,
} from "../src/lib/codex/interchange/types";

const book = (name: string) =>
  JSON.stringify({
    name,
    entries: {
      "1": { uid: 1, key: [`${name} One`, `${name} Alias`], comment: `${name} One`, content: "a" },
      "2": { uid: 2, key: [`${name} Two`], comment: `${name} Two`, content: "b" },
      "3": { uid: 3, key: [`${name} Three`], comment: `${name} Three`, content: "c" },
    },
  });

describe("Imported group lookup filters in the database (STO-1286)", { timeout: 30_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const novelId = `group-novel-${runId}`;
  const otherNovelId = `group-other-novel-${runId}`;
  const now = Temporal.Now.plainDateTimeISO();

  const createEntry = (id: string, ownerId: string, novel: string, customFields: unknown) =>
    db.orm.public.CodexEntry.create({
      id,
      ownerId,
      novelId: novel,
      name: id,
      type: "LORE",
      customFields,
      updatedAt: now,
    } as any);

  beforeAll(async () => {
    for (const id of [userId, otherUserId]) {
      await db.orm.public.User.create({
        id,
        email: `${id}@inkstory.local`,
        planTier: "PRO",
        updatedAt: now,
      } as any);
    }
    for (const [id, ownerId] of [
      [novelId, userId],
      [otherNovelId, otherUserId],
    ] as const) {
      await db.orm.public.Novel.create({
        id,
        ownerId,
        title: id,
        position: 0,
        updatedAt: now,
      } as any);
    }
  });

  afterAll(async () => {
    for (const id of [userId, otherUserId]) {
      try {
        await db.orm.public.User.where({ id }).delete();
      } catch {
        // ignore
      }
    }
  });

  it("returns only the group's live entries and skips the rest of the library", async () => {
    const target = await importLorebook(userId, book("Target"), { novelId });
    const sibling = await importLorebook(userId, book("Sibling"), { novelId });
    const foreign = await importLorebook(otherUserId, book("Foreign"), { novelId: otherNovelId });

    // A large unrelated library: native entries with default null and plain customFields.
    await Promise.all([
      createEntry(`group-native-null-${runId}`, userId, novelId, null),
      createEntry(`group-native-corrupt-${runId}`, userId, novelId, {
        [INTERCHANGE_ENVELOPE_KEY]: "not-an-object",
      }),
      createEntry(`group-native-null-env-${runId}`, userId, novelId, {
        [INTERCHANGE_ENVELOPE_KEY]: null,
      }),
      ...Array.from({ length: 40 }, (_, i) =>
        createEntry(`group-native-${runId}-${i}`, userId, novelId, { mood: "calm" }),
      ),
    ]);
    // Card-format envelope sharing the group id: excluded by the SQL format match.
    await createEntry(`group-card-${runId}`, userId, novelId, {
      [INTERCHANGE_ENVELOPE_KEY]: { format: CARD_FORMAT, groupId: target.groupId },
    });
    // Hand-forged lorebook envelope: matched by SQL, rejected by JS validation.
    const forgedId = `group-forged-${runId}`;
    await createEntry(forgedId, userId, novelId, {
      [INTERCHANGE_ENVELOPE_KEY]: { format: LOREBOOK_FORMAT, groupId: target.groupId },
    });
    // Another user's entry forged with the same group id.
    await createEntry(`group-foreign-forged-${runId}`, otherUserId, otherNovelId, {
      [INTERCHANGE_ENVELOPE_KEY]: { format: LOREBOOK_FORMAT, groupId: target.groupId },
    });

    // Soft-delete one entry of the target group.
    const deletedId = target.created[2].id;
    await db.orm.public.CodexEntry.where({ id: deletedId }).update({ deletedAt: now } as any);

    const liveTargetIds = target.created.slice(0, 2).map((c) => c.id);

    const ids = await findImportedGroupEntryIds(userId, target.groupId);
    expect([...ids].sort()).toEqual([...liveTargetIds, forgedId].sort());

    const sources = await loadImportedGroupBookSources(userId, target.groupId);
    expect(sources.map((s) => s.id)).toEqual(liveTargetIds);
    expect(sources.map((s) => s.name)).toEqual(["Target One", "Target Two"]);
    expect(sources[0].aliases.sort()).toEqual(["Target Alias", "Target One"]);

    // Other groups and other owners stay isolated.
    expect((await loadImportedGroupBookSources(userId, sibling.groupId)).map((s) => s.id)).toEqual(
      sibling.created.map((c) => c.id),
    );
    expect(await loadImportedGroupBookSources(userId, foreign.groupId)).toEqual([]);
    expect(await findImportedGroupEntryIds(otherUserId, target.groupId)).toEqual([
      `group-foreign-forged-${runId}`,
    ]);
    expect(await loadImportedGroupBookSources(otherUserId, target.groupId)).toEqual([]);
    expect(await loadImportedGroupBookSources(userId, crypto.randomUUID())).toEqual([]);
  });
});
