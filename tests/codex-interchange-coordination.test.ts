import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { db } from "../src/lib/prisma";
import {
  createCodexAlias,
  deleteCodexAlias,
  deleteCodexEntry,
  getCodexEntry,
  updateCodexEntry,
} from "../src/lib/codex/service";
import {
  exportCharacterCard,
  importCharacterCard,
} from "../src/lib/codex/interchange/card-service";
import { exportLorebook } from "../src/lib/codex/interchange/service";
import { parseCharacterCard } from "../src/lib/codex/interchange/character-card";
import type { InterchangeObject } from "../src/lib/codex/interchange/types";

const card = JSON.stringify({
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Selene Cross",
    description: "Sanctuary archivist.",
    personality: "Pensive",
    system_prompt: "COORDINATION OVERRIDE: verify lore overlay",
    character_book: {
      name: "Sanctum Archives",
      entries: [
        {
          keys: ["Sanctum"],
          content: "Ancient archive",
          enabled: true,
          insertion_order: 1,
          id: 51,
          comment: "Sanctum",
        },
        {
          keys: ["Aurora"],
          secondary_keys: ["dusk"],
          selective: true,
          content: "Luminous veil",
          enabled: true,
          insertion_order: 2,
          id: 52,
          comment: "Aurora",
        },
      ],
    },
  },
});

describe("Codex interchange coordination (STO-1261)", { timeout: 30_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = `coord-user-${runId}`;
  const novelId = `coord-novel-${runId}`;

  beforeAll(async () => {
    const now = Temporal.Now.plainDateTimeISO();
    await db.orm.public.User.create({
      id: userId,
      email: `${userId}@inkstory.local`,
      planTier: "PRO",
      updatedAt: now,
    } as any);
    await db.orm.public.Novel.create({
      id: novelId,
      ownerId: userId,
      title: "Coordination",
      position: 0,
      updatedAt: now,
    } as any);
  });

  afterAll(async () => {
    try {
      await db.orm.public.User.where({ id: userId }).delete();
    } catch {
      // ignore
    }
  });

  it("overlays edited imported book entries on card export and keeps deleted ones", async () => {
    const imported = await importCharacterCard(
      userId,
      { encoding: "json", content: card },
      { novelId, importEmbeddedBook: true, bookActivationOverrides: { "52": "DETECTED" } },
    );
    const sanctum = imported.bookEntries[0]!;
    const aurora = imported.bookEntries[1]!;

    await updateCodexEntry(userId, sanctum.id, {
      name: "Inner Sanctum",
      description: "Restored archive",
      trackingMode: "ALWAYS",
    });
    const current = await getCodexEntry(userId, sanctum.id);
    for (const alias of current.aliases) {
      await deleteCodexAlias(userId, alias.id);
    }
    await createCodexAlias(userId, { entryId: sanctum.id, name: "Sanctum" });
    await createCodexAlias(userId, { entryId: sanctum.id, name: "Citadel" });

    const exported = await exportCharacterCard(userId, { entryId: imported.character.id });
    expect(exported.warnings.map((w) => w.code)).toContain("EMBEDDED_BOOK_OVERLAID");
    expect(exported.warnings.map((w) => w.code)).not.toContain("EMBEDDED_BOOK_FROM_IMPORT");
    const entries = ((exported.card.data as InterchangeObject).character_book as InterchangeObject)
      .entries as InterchangeObject[];
    expect(entries).toMatchObject([
      {
        id: 51,
        comment: "Inner Sanctum",
        content: "Restored archive",
        constant: true,
        enabled: true,
      },
      { id: 52, comment: "Aurora", content: "Luminous veil", keys: ["Aurora"] },
    ]);
    expect(entries[0]!.keys).toEqual(expect.arrayContaining(["Sanctum", "Citadel"]));
    expect(entries[0]!.keys).toHaveLength(2);
    // Secondary keys stay preserved-only and are not turned into aliases.
    expect(entries[1]!.secondary_keys).toEqual(["dusk"]);

    const reimported = parseCharacterCard({
      encoding: "json",
      content: JSON.stringify(exported.card),
    });
    expect(reimported.preview.name).toBe("Selene Cross");
    expect(reimported.embeddedBook!.preview.entries).toMatchObject([
      {
        sourceEntryKey: "51",
        name: "Inner Sanctum",
        trackingMode: "ALWAYS",
        aliases: ["Sanctum", "Citadel"],
      },
      { sourceEntryKey: "52", name: "Aurora", trackingMode: "NEVER" },
    ]);

    const lore = await exportLorebook(userId, { entryIds: [sanctum.id, aurora.id] });
    expect((lore.lorebook.entries as InterchangeObject)["0"]).toMatchObject({
      comment: "Inner Sanctum",
      content: "Restored archive",
      key: ["Sanctum", "Citadel"],
      constant: true,
    });

    await deleteCodexEntry(userId, aurora.id);
    const afterDelete = await exportCharacterCard(userId, { entryId: imported.character.id });
    expect(afterDelete.warnings.map((w) => w.code)).toEqual([
      "EMBEDDED_BOOK_OVERLAID",
      "EMBEDDED_BOOK_ENTRY_MISSING",
    ]);
    const kept = ((afterDelete.card.data as InterchangeObject).character_book as InterchangeObject)
      .entries as InterchangeObject[];
    expect(kept[1]).toMatchObject({ id: 52, comment: "Aurora", content: "Luminous veil" });
  });
});
