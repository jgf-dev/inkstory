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

  const user = await prisma.user.upsert({
    where: { id: seedUserId },
    update: {
      email: "seed@inkstory.local",
      name: "Seed User",
    },
    create: {
      id: seedUserId,
      email: "seed@inkstory.local",
      name: "Seed User",
    },
  });

  const series = await prisma.series.upsert({
    where: { id: "seed-series-1" },
    update: {
      title: "The Inkwell Chronicles",
      description: "Demo series created by `npm run db:seed`.",
      position: 0,
    },
    create: {
      id: "seed-series-1",
      ownerId: user.id,
      title: "The Inkwell Chronicles",
      description: "Demo series created by `npm run db:seed`.",
      position: 0,
    },
  });

  const novel = await prisma.novel.upsert({
    where: { id: "seed-novel-1" },
    update: {
      seriesId: series.id,
      title: "The First Draft",
      subtitle: "A demo novel",
      position: 0,
    },
    create: {
      id: "seed-novel-1",
      ownerId: user.id,
      seriesId: series.id,
      title: "The First Draft",
      subtitle: "A demo novel",
      position: 0,
    },
  });

  const act = await prisma.act.upsert({
    where: { id: "seed-act-1" },
    update: {
      title: "Act I — The Discovery",
      position: 0,
    },
    create: {
      id: "seed-act-1",
      novelId: novel.id,
      title: "Act I — The Discovery",
      position: 0,
    },
  });

  const chapter = await prisma.chapter.upsert({
    where: { id: "seed-chapter-1" },
    update: {
      title: "Chapter 1 — Opening",
      position: 0,
    },
    create: {
      id: "seed-chapter-1",
      actId: act.id,
      title: "Chapter 1 — Opening",
      position: 0,
    },
  });

  const sceneContent =
    "The rain had been falling since before dawn. By the time Mara opened her eyes, the city already sounded like it was drowning. She reached for the Glass Weaver's Quill on her nightstand, feeling the hum of Master Corvus's wards echoing from the Sunken Archives.";
  const sceneSummary =
    "Protagonist wakes to a storm that foreshadows the larger conflict.";
  const sceneWordCount = 52;

  const scene = await prisma.scene.upsert({
    where: { id: "seed-scene-1" },
    update: {
      title: "A Quiet Morning",
      label: "Opening",
      content: sceneContent,
      summary: sceneSummary,
      position: 0,
      wordCount: sceneWordCount,
    },
    create: {
      id: "seed-scene-1",
      chapterId: chapter.id,
      title: "A Quiet Morning",
      label: "Opening",
      content: sceneContent,
      summary: sceneSummary,
      position: 0,
      wordCount: sceneWordCount,
    },
  });

  // ─── Epic 1: Codex Entities (STO-1167) ─────────────────────────────────────

  const maraEntry = await prisma.codexEntry.upsert({
    where: { id: "seed-codex-mara" },
    update: {
      novelId: novel.id,
      seriesId: null,
      name: "Mara Vance",
      type: "CHARACTER",
      description: "A young archivist possessing the forbidden art of glass weaving.",
      notes: "Central protagonist. Secretly apprenticed to Master Corvus.",
      trackingMode: "ALWAYS",
      seriesScoped: false,
      color: "#3b82f6",
      customFields: {
        age: 21,
        element: "Glass / Light",
      },
    },
    create: {
      id: "seed-codex-mara",
      ownerId: user.id,
      novelId: novel.id,
      name: "Mara Vance",
      type: "CHARACTER",
      description: "A young archivist possessing the forbidden art of glass weaving.",
      notes: "Central protagonist. Secretly apprenticed to Master Corvus.",
      trackingMode: "ALWAYS",
      seriesScoped: false,
      color: "#3b82f6",
      customFields: {
        age: 21,
        element: "Glass / Light",
      },
    },
  });

  await prisma.codexAlias.upsert({
    where: { id: "seed-alias-mara-1" },
    update: {
      name: "The Glass Weaver",
    },
    create: {
      id: "seed-alias-mara-1",
      entryId: maraEntry.id,
      name: "The Glass Weaver",
    },
  });

  await prisma.codexTag.upsert({
    where: { id: "seed-tag-mara-1" },
    update: {
      name: "Protagonist",
      color: "#3b82f6",
    },
    create: {
      id: "seed-tag-mara-1",
      entryId: maraEntry.id,
      name: "Protagonist",
      color: "#3b82f6",
    },
  });

  const corvusEntry = await prisma.codexEntry.upsert({
    where: { id: "seed-codex-corvus" },
    update: {
      novelId: novel.id,
      seriesId: null,
      name: "Master Corvus",
      type: "CHARACTER",
      description: "Senior keeper of the Sunken Archives and Mara's clandestine mentor.",
      notes: "Speaks in riddles; harbors secrets regarding the Great Fracture.",
      trackingMode: "DETECTED",
      seriesScoped: false,
      color: "#8b5cf6",
    },
    create: {
      id: "seed-codex-corvus",
      ownerId: user.id,
      novelId: novel.id,
      name: "Master Corvus",
      type: "CHARACTER",
      description: "Senior keeper of the Sunken Archives and Mara's clandestine mentor.",
      notes: "Speaks in riddles; harbors secrets regarding the Great Fracture.",
      trackingMode: "DETECTED",
      seriesScoped: false,
      color: "#8b5cf6",
    },
  });

  await prisma.codexAlias.upsert({
    where: { id: "seed-alias-corvus-1" },
    update: {
      name: "The Raven Keeper",
    },
    create: {
      id: "seed-alias-corvus-1",
      entryId: corvusEntry.id,
      name: "The Raven Keeper",
    },
  });

  const archivesEntry = await prisma.codexEntry.upsert({
    where: { id: "seed-codex-archives" },
    update: {
      novelId: novel.id,
      seriesId: null,
      name: "The Sunken Archives",
      type: "LOCATION",
      description: "Subterranean repository of forbidden knowledge beneath the drowned city.",
      notes: "Protected by ancient elemental wards.",
      trackingMode: "DETECTED",
      seriesScoped: false,
      color: "#10b981",
    },
    create: {
      id: "seed-codex-archives",
      ownerId: user.id,
      novelId: novel.id,
      name: "The Sunken Archives",
      type: "LOCATION",
      description: "Subterranean repository of forbidden knowledge beneath the drowned city.",
      notes: "Protected by ancient elemental wards.",
      trackingMode: "DETECTED",
      seriesScoped: false,
      color: "#10b981",
    },
  });

  const quillEntry = await prisma.codexEntry.upsert({
    where: { id: "seed-codex-quill" },
    update: {
      novelId: novel.id,
      seriesId: null,
      name: "Glass Weaver's Quill",
      type: "ITEM",
      description: "An iridescent stylus capable of etching light onto raw glass.",
      notes: "Heritage artifact passed down from the First Order.",
      trackingMode: "DETECTED",
      seriesScoped: false,
      color: "#f59e0b",
    },
    create: {
      id: "seed-codex-quill",
      ownerId: user.id,
      novelId: novel.id,
      name: "Glass Weaver's Quill",
      type: "ITEM",
      description: "An iridescent stylus capable of etching light onto raw glass.",
      notes: "Heritage artifact passed down from the First Order.",
      trackingMode: "DETECTED",
      seriesScoped: false,
      color: "#f59e0b",
    },
  });

  const fractureEntry = await prisma.codexEntry.upsert({
    where: { id: "seed-codex-fracture" },
    update: {
      novelId: null,
      seriesId: series.id,
      name: "The Great Fracture",
      type: "LORE",
      description: "The cataclysmic event three centuries ago that sundered the continent.",
      notes: "Universal lore across all books in the Inkwell Chronicles.",
      trackingMode: "DETECTED",
      seriesScoped: true,
      color: "#ef4444",
    },
    create: {
      id: "seed-codex-fracture",
      ownerId: user.id,
      seriesId: series.id,
      name: "The Great Fracture",
      type: "LORE",
      description: "The cataclysmic event three centuries ago that sundered the continent.",
      notes: "Universal lore across all books in the Inkwell Chronicles.",
      trackingMode: "DETECTED",
      seriesScoped: true,
      color: "#ef4444",
    },
  });

  // Relations
  await prisma.codexRelation.upsert({
    where: { id: "seed-rel-mara-corvus" },
    update: {
      relationType: "APPRENTICE_OF",
      reverseType: "MENTOR_TO",
      description: "Corvus teaches Mara the forbidden arts in secret.",
    },
    create: {
      id: "seed-rel-mara-corvus",
      sourceEntryId: maraEntry.id,
      targetEntryId: corvusEntry.id,
      relationType: "APPRENTICE_OF",
      reverseType: "MENTOR_TO",
      description: "Corvus teaches Mara the forbidden arts in secret.",
    },
  });

  await prisma.codexRelation.upsert({
    where: { id: "seed-rel-corvus-archives" },
    update: {
      relationType: "KEEPER_OF",
      reverseType: "GUARDED_BY",
      description: "Corvus maintains and guards the Sunken Archives.",
    },
    create: {
      id: "seed-rel-corvus-archives",
      sourceEntryId: corvusEntry.id,
      targetEntryId: archivesEntry.id,
      relationType: "KEEPER_OF",
      reverseType: "GUARDED_BY",
      description: "Corvus maintains and guards the Sunken Archives.",
    },
  });

  await prisma.codexRelation.upsert({
    where: { id: "seed-rel-mara-quill" },
    update: {
      relationType: "OWNS",
      reverseType: "WIELDED_BY",
      description: "Mara inherited the quill from her mother.",
    },
    create: {
      id: "seed-rel-mara-quill",
      sourceEntryId: maraEntry.id,
      targetEntryId: quillEntry.id,
      relationType: "OWNS",
      reverseType: "WIELDED_BY",
      description: "Mara inherited the quill from her mother.",
    },
  });

  // Progression
  await prisma.codexProgression.upsert({
    where: { id: "seed-prog-mara-scene-1" },
    update: {
      mode: "ADDITION",
      description: "Noticed an unusual vibration from the quill coinciding with the storm.",
      notes: "Initial trigger for Mara's quest.",
      position: 0,
    },
    create: {
      id: "seed-prog-mara-scene-1",
      entryId: maraEntry.id,
      sceneId: scene.id,
      mode: "ADDITION",
      description: "Noticed an unusual vibration from the quill coinciding with the storm.",
      notes: "Initial trigger for Mara's quest.",
      position: 0,
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
