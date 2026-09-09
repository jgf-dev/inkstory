/**
 * Seed script — creates a demo user, series, novel, act, chapter, scene.
 * Run with: npm run db:seed
 *
 * The seed user is `seed@inkstory.local` (no password — for local dev only).
 * Sign up a real account via the app instead.
 */

// tsx runs this directly (not via prisma.config.ts), so we load env manually.
import { config } from "dotenv";
config({ path: ".env.local", override: false });
config({ path: ".env", override: false });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Use DIRECT_URL (session pooler, port 5432) for seeding.
// SESSION pooler supports DDL + prepared statements; TRANSACTION pooler (port 6543) does not.
// Fall back to DATABASE_URL if DIRECT_URL is not set.
const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});
const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["info", "query", "error", "warn"] : ["error"],
});

async function main() {
  // Use a stable seed user id; Supabase auth sync creates the row at first login
  // for real users, but the seed user needs an explicit row to attach data to.
  const seedUserId = "00000000-0000-0000-0000-000000000001";

  const userFields = {
    email: "seed@inkstory.local",
    name: "Seed User",
  } as const;

  const user = await prisma.user.upsert({
    where: { id: seedUserId },
    update: userFields,
    create: {
      id: seedUserId,
      ...userFields,
    },
  });

  const seriesFields = {
    title: "The Inkwell Chronicles",
    description: "Demo series created by `npm run db:seed`.",
    position: 0,
  } as const;

  const series = await prisma.series.upsert({
    where: { id: "seed-series-1" },
    update: seriesFields,
    create: {
      id: "seed-series-1",
      ownerId: user.id,
      ...seriesFields,
    },
  });

  const novelFields = {
    seriesId: series.id,
    title: "The First Draft",
    subtitle: "A demo novel",
    position: 0,
  } as const;

  const novel = await prisma.novel.upsert({
    where: { id: "seed-novel-1" },
    update: novelFields,
    create: {
      id: "seed-novel-1",
      ownerId: user.id,
      ...novelFields,
    },
  });

  const actFields = {
    title: "Act I — The Discovery",
    position: 0,
  } as const;

  const act = await prisma.act.upsert({
    where: { id: "seed-act-1" },
    update: actFields,
    create: {
      id: "seed-act-1",
      novelId: novel.id,
      ...actFields,
    },
  });

  const chapterFields = {
    title: "Chapter 1 — Opening",
    position: 0,
  } as const;

  const chapter = await prisma.chapter.upsert({
    where: { id: "seed-chapter-1" },
    update: chapterFields,
    create: {
      id: "seed-chapter-1",
      actId: act.id,
      ...chapterFields,
    },
  });

  const sceneFields = {
    title: "A Quiet Morning",
    label: "Opening",
    content:
      "The rain had been falling since before dawn. By the time Mara opened her eyes, the city already sounded like it was drowning. She reached for the Glass Weaver's Quill on her nightstand, feeling the hum of Master Corvus's wards echoing from the Sunken Archives.",
    summary: "Protagonist wakes to a storm that foreshadows the larger conflict.",
    position: 0,
    wordCount: 52,
  } as const;

  const scene = await prisma.scene.upsert({
    where: { id: "seed-scene-1" },
    update: sceneFields,
    create: {
      id: "seed-scene-1",
      chapterId: chapter.id,
      ...sceneFields,
    },
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
  };

  const maraEntry = await prisma.codexEntry.upsert({
    where: { id: "seed-codex-mara" },
    update: maraFields,
    create: {
      id: "seed-codex-mara",
      ownerId: user.id,
      ...maraFields,
    },
  });

  const maraAliasFields = { name: "The Glass Weaver" } as const;
  await prisma.codexAlias.upsert({
    where: { id: "seed-alias-mara-1" },
    update: maraAliasFields,
    create: {
      id: "seed-alias-mara-1",
      entryId: maraEntry.id,
      ...maraAliasFields,
    },
  });

  const maraTagFields = { name: "Protagonist", color: "#3b82f6" } as const;
  await prisma.codexTag.upsert({
    where: { id: "seed-tag-mara-1" },
    update: maraTagFields,
    create: {
      id: "seed-tag-mara-1",
      entryId: maraEntry.id,
      ...maraTagFields,
    },
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
  };

  const corvusEntry = await prisma.codexEntry.upsert({
    where: { id: "seed-codex-corvus" },
    update: corvusFields,
    create: {
      id: "seed-codex-corvus",
      ownerId: user.id,
      ...corvusFields,
    },
  });

  const corvusAliasFields = { name: "The Raven Keeper" } as const;
  await prisma.codexAlias.upsert({
    where: { id: "seed-alias-corvus-1" },
    update: corvusAliasFields,
    create: {
      id: "seed-alias-corvus-1",
      entryId: corvusEntry.id,
      ...corvusAliasFields,
    },
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
  };

  const archivesEntry = await prisma.codexEntry.upsert({
    where: { id: "seed-codex-archives" },
    update: archivesFields,
    create: {
      id: "seed-codex-archives",
      ownerId: user.id,
      ...archivesFields,
    },
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
  };

  const quillEntry = await prisma.codexEntry.upsert({
    where: { id: "seed-codex-quill" },
    update: quillFields,
    create: {
      id: "seed-codex-quill",
      ownerId: user.id,
      ...quillFields,
    },
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
  };

  const fractureEntry = await prisma.codexEntry.upsert({
    where: { id: "seed-codex-fracture" },
    update: fractureFields,
    create: {
      id: "seed-codex-fracture",
      ownerId: user.id,
      ...fractureFields,
    },
  });

  // Relations
  const maraCorvusRelation = {
    relationType: "APPRENTICE_OF",
    reverseType: "MENTOR_TO",
    description: "Corvus teaches Mara the forbidden arts in secret.",
  } as const;
  await prisma.codexRelation.upsert({
    where: { id: "seed-rel-mara-corvus" },
    update: maraCorvusRelation,
    create: {
      id: "seed-rel-mara-corvus",
      sourceEntryId: maraEntry.id,
      targetEntryId: corvusEntry.id,
      ...maraCorvusRelation,
    },
  });

  const corvusArchivesRelation = {
    relationType: "KEEPER_OF",
    reverseType: "GUARDED_BY",
    description: "Corvus maintains and guards the Sunken Archives.",
  } as const;
  await prisma.codexRelation.upsert({
    where: { id: "seed-rel-corvus-archives" },
    update: corvusArchivesRelation,
    create: {
      id: "seed-rel-corvus-archives",
      sourceEntryId: corvusEntry.id,
      targetEntryId: archivesEntry.id,
      ...corvusArchivesRelation,
    },
  });

  const maraQuillRelation = {
    relationType: "OWNS",
    reverseType: "WIELDED_BY",
    description: "Mara inherited the quill from her mother.",
  } as const;
  await prisma.codexRelation.upsert({
    where: { id: "seed-rel-mara-quill" },
    update: maraQuillRelation,
    create: {
      id: "seed-rel-mara-quill",
      sourceEntryId: maraEntry.id,
      targetEntryId: quillEntry.id,
      ...maraQuillRelation,
    },
  });

  // Progression
  const maraProgression = {
    mode: "ADDITION" as const,
    description: "Noticed an unusual vibration from the quill coinciding with the storm.",
    notes: "Initial trigger for Mara's quest.",
    position: 0,
  };
  await prisma.codexProgression.upsert({
    where: { id: "seed-prog-mara-scene-1" },
    update: maraProgression,
    create: {
      id: "seed-prog-mara-scene-1",
      entryId: maraEntry.id,
      sceneId: scene.id,
      ...maraProgression,
    },
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
    await prisma.$disconnect();
  });
