/**
 * Seed script — creates a demo user, series, novel, act, chapter, scene, and codex entities.
 * Run with: npm run db:seed
 *
 * The seed user is `seed@inkstory.local` (no password — for local dev only).
 * Sign up a real account via the app instead.
 */

// tsx runs this directly (not via prisma.config.ts), so we load env manually.
import { config } from "dotenv";
config({ path: ".env.local", override: false });
config({ path: ".env", override: false });

import { Temporal } from "temporal-polyfill";
import postgres from "@prisma/orm-postgres/runtime";
import type { Contract } from "./contract.d";
import contractJson from "./contract.json" with { type: "json" };

// Use DIRECT_URL (session pooler, port 5432) for seeding.
// SESSION pooler supports DDL + prepared statements; TRANSACTION pooler (port 6543) does not.
// Fall back to DATABASE_URL if DIRECT_URL is not set.
const db = postgres<Contract>({
  contractJson,
  url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
});

async function main() {
  const now = Temporal.Now.plainDateTimeISO();
  // Use a stable seed user id; Supabase auth sync creates the row at first login
  // for real users, but the seed user needs an explicit row to attach data to.
  const seedUserId = "00000000-0000-0000-0000-000000000001";

  const userFields = {
    email: "seed@inkstory.local",
    name: "Seed User",
    updatedAt: now,
  } as const;

  const user = await db.orm.public.User.upsert({
    create: {
      id: seedUserId,
      ...userFields,
    },
    update: userFields,
  });

  const seriesFields = {
    title: "The Inkwell Chronicles",
    description: "Demo series created by `npm run db:seed`.",
    position: 0,
    updatedAt: now,
  } as const;

  const series = await db.orm.public.Series.upsert({
    create: {
      id: "seed-series-1",
      ownerId: user.id,
      ...seriesFields,
    },
    update: seriesFields,
  });

  const novelFields = {
    seriesId: series.id,
    title: "The First Draft",
    subtitle: "A demo novel",
    position: 0,
    updatedAt: now,
  } as const;

  const novel = await db.orm.public.Novel.upsert({
    create: {
      id: "seed-novel-1",
      ownerId: user.id,
      ...novelFields,
    },
    update: novelFields,
  });

  const actFields = {
    title: "Act I — The Discovery",
    position: 0,
    updatedAt: now,
  } as const;

  const act = await db.orm.public.Act.upsert({
    create: {
      id: "seed-act-1",
      novelId: novel.id,
      ...actFields,
    },
    update: actFields,
  });

  const chapterFields = {
    title: "Chapter 1 — Opening",
    position: 0,
    updatedAt: now,
  } as const;

  const chapter = await db.orm.public.Chapter.upsert({
    create: {
      id: "seed-chapter-1",
      actId: act.id,
      ...chapterFields,
    },
    update: chapterFields,
  });

  const sceneFields = {
    title: "A Quiet Morning",
    label: "Opening",
    content:
      "The rain had been falling since before dawn. By the time Mara opened her eyes, the city already sounded like it was drowning. She reached for the Glass Weaver's Quill on her nightstand, feeling the hum of Master Corvus's wards echoing from the Sunken Archives.",
    summary: "Protagonist wakes to a storm that foreshadows the larger conflict.",
    position: 0,
    wordCount: 52,
    updatedAt: now,
  } as const;

  const scene = await db.orm.public.Scene.upsert({
    create: {
      id: "seed-scene-1",
      chapterId: chapter.id,
      ...sceneFields,
    },
    update: sceneFields,
  });

  // ─── Epic 1: Codex Entities (STO-1167) ─────────────────────────────────────

  const maraFields = {
    novelId: novel.id,
    seriesId: null as string | null,
    name: "Mara Vance",
    type: "CHARACTER" as const,
    description: "A young archivist possessing the forbidden art of glass weaving.",
    notes: "Central protagonist. Secretly apprenticed to Master Corvus.",
    trackingMode: "ALWAYS" as const,
    seriesScoped: false,
    color: "#3b82f6",
    customFields: {
      age: 21,
      element: "Glass / Light",
    },
    updatedAt: now,
  };

  const maraEntry = await db.orm.public.CodexEntry.upsert({
    create: {
      id: "seed-codex-mara",
      ownerId: user.id,
      ...maraFields,
    },
    update: maraFields,
  });

  const maraAliasFields = { name: "The Glass Weaver", updatedAt: now } as const;
  await db.orm.public.CodexAlias.upsert({
    create: {
      id: "seed-alias-mara-1",
      entryId: maraEntry.id,
      ...maraAliasFields,
    },
    update: maraAliasFields,
  });

  const maraTagFields = { name: "Protagonist", color: "#3b82f6", updatedAt: now } as const;
  await db.orm.public.CodexTag.upsert({
    create: {
      id: "seed-tag-mara-1",
      entryId: maraEntry.id,
      ...maraTagFields,
    },
    update: maraTagFields,
  });

  const corvusFields = {
    novelId: novel.id,
    seriesId: null as string | null,
    name: "Master Corvus",
    type: "CHARACTER" as const,
    description: "Senior keeper of the Sunken Archives and Mara's clandestine mentor.",
    notes: "Speaks in riddles; harbors secrets regarding the Great Fracture.",
    trackingMode: "DETECTED" as const,
    seriesScoped: false,
    color: "#8b5cf6",
    updatedAt: now,
  };

  const corvusEntry = await db.orm.public.CodexEntry.upsert({
    create: {
      id: "seed-codex-corvus",
      ownerId: user.id,
      ...corvusFields,
    },
    update: corvusFields,
  });

  const corvusAliasFields = { name: "The Raven Keeper", updatedAt: now } as const;
  await db.orm.public.CodexAlias.upsert({
    create: {
      id: "seed-alias-corvus-1",
      entryId: corvusEntry.id,
      ...corvusAliasFields,
    },
    update: corvusAliasFields,
  });

  const archivesFields = {
    novelId: novel.id,
    seriesId: null as string | null,
    name: "The Sunken Archives",
    type: "LOCATION" as const,
    description: "Subterranean repository of forbidden knowledge beneath the drowned city.",
    notes: "Protected by ancient elemental wards.",
    trackingMode: "DETECTED" as const,
    seriesScoped: false,
    color: "#10b981",
    updatedAt: now,
  };

  const archivesEntry = await db.orm.public.CodexEntry.upsert({
    create: {
      id: "seed-codex-archives",
      ownerId: user.id,
      ...archivesFields,
    },
    update: archivesFields,
  });

  const quillFields = {
    novelId: novel.id,
    seriesId: null as string | null,
    name: "Glass Weaver's Quill",
    type: "ITEM" as const,
    description: "An iridescent stylus capable of etching light onto raw glass.",
    notes: "Heritage artifact passed down from the First Order.",
    trackingMode: "DETECTED" as const,
    seriesScoped: false,
    color: "#f59e0b",
    updatedAt: now,
  };

  const quillEntry = await db.orm.public.CodexEntry.upsert({
    create: {
      id: "seed-codex-quill",
      ownerId: user.id,
      ...quillFields,
    },
    update: quillFields,
  });

  const fractureFields = {
    novelId: null as string | null,
    seriesId: series.id,
    name: "The Great Fracture",
    type: "LORE" as const,
    description: "The cataclysmic event three centuries ago that sundered the continent.",
    notes: "Universal lore across all books in the Inkwell Chronicles.",
    trackingMode: "DETECTED" as const,
    seriesScoped: true,
    color: "#ef4444",
    updatedAt: now,
  };

  const fractureEntry = await db.orm.public.CodexEntry.upsert({
    create: {
      id: "seed-codex-fracture",
      ownerId: user.id,
      ...fractureFields,
    },
    update: fractureFields,
  });

  // Relations
  const maraCorvusRelation = {
    relationType: "APPRENTICE_OF",
    reverseType: "MENTOR_TO",
    description: "Corvus teaches Mara the forbidden arts in secret.",
    updatedAt: now,
  } as const;
  await db.orm.public.CodexRelation.upsert({
    create: {
      id: "seed-rel-mara-corvus",
      sourceEntryId: maraEntry.id,
      targetEntryId: corvusEntry.id,
      ...maraCorvusRelation,
    },
    update: maraCorvusRelation,
  });

  const corvusArchivesRelation = {
    relationType: "KEEPER_OF",
    reverseType: "GUARDED_BY",
    description: "Corvus maintains and guards the Sunken Archives.",
    updatedAt: now,
  } as const;
  await db.orm.public.CodexRelation.upsert({
    create: {
      id: "seed-rel-corvus-archives",
      sourceEntryId: corvusEntry.id,
      targetEntryId: archivesEntry.id,
      ...corvusArchivesRelation,
    },
    update: corvusArchivesRelation,
  });

  const maraQuillRelation = {
    relationType: "OWNS",
    reverseType: "WIELDED_BY",
    description: "Mara inherited the quill from her mother.",
    updatedAt: now,
  } as const;
  await db.orm.public.CodexRelation.upsert({
    create: {
      id: "seed-rel-mara-quill",
      sourceEntryId: maraEntry.id,
      targetEntryId: quillEntry.id,
      ...maraQuillRelation,
    },
    update: maraQuillRelation,
  });

  // Progression
  const maraProgression = {
    mode: "ADDITION" as const,
    description: "Noticed an unusual vibration from the quill coinciding with the storm.",
    notes: "Initial trigger for Mara's quest.",
    position: 0,
    updatedAt: now,
  };
  await db.orm.public.CodexProgression.upsert({
    create: {
      id: "seed-prog-mara-scene-1",
      entryId: maraEntry.id,
      sceneId: scene.id,
      ...maraProgression,
    },
    update: maraProgression,
  });

  console.log("✅ Seeded:", {
    user: user.email,
    novel: novel.title,
    codexEntries: [
      maraEntry.name,
      corvusEntry.name,
      archivesEntry.name,
      quillEntry.name,
      fractureEntry.name,
    ],
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.close();
  });
