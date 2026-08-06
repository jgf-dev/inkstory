/**
 * Seed script — creates a demo user, series, novel, act, chapter, scene.
 * Run with: npm run db:seed
 *
 * The seed user is `seed@inkstory.local` (no password — for local dev only).
 * Sign up a real account via the app instead.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Use a stable seed user id; Supabase auth sync creates the row at first login
  // for real users, but the seed user needs an explicit row to attach data to.
  const seedUserId = "00000000-0000-0000-0000-000000000001";

  const user = await prisma.user.upsert({
    where: { id: seedUserId },
    update: {},
    create: {
      id: seedUserId,
      email: "seed@inkstory.local",
      name: "Seed User",
    },
  });

  const series = await prisma.series.upsert({
    where: { id: "seed-series-1" },
    update: {},
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
    update: {},
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
    update: {},
    create: {
      id: "seed-act-1",
      novelId: novel.id,
      title: "Act I — The Discovery",
      position: 0,
    },
  });

  const chapter = await prisma.chapter.upsert({
    where: { id: "seed-chapter-1" },
    update: {},
    create: {
      id: "seed-chapter-1",
      actId: act.id,
      title: "Chapter 1 — Opening",
      position: 0,
    },
  });

  await prisma.scene.upsert({
    where: { id: "seed-scene-1" },
    update: {},
    create: {
      id: "seed-scene-1",
      chapterId: chapter.id,
      title: "A Quiet Morning",
      label: "Opening",
      content:
        "The rain had been falling since before dawn. By the time Mara opened her eyes, the city already sounded like it was drowning.",
      summary: "Protagonist wakes to a storm that foreshadows the larger conflict.",
      position: 0,
      wordCount: 26,
    },
  });

  console.log("✅ Seeded:", { user: user.email, novel: novel.title });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
