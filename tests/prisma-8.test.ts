import { afterAll, describe, expect, it } from "vite-plus/test";
import { db } from "../src/lib/prisma";

describe("Prisma 8 Database Integration", () => {
  afterAll(async () => {
    await db.close();
  });

  it("queries count aggregates on models via db.orm", async () => {
    const [seriesRes, novelRes, userRes] = await Promise.all([
      db.orm.public.Series.aggregate((a) => ({ count: a.count() })),
      db.orm.public.Novel.aggregate((a) => ({ count: a.count() })),
      db.orm.public.User.aggregate((a) => ({ count: a.count() })),
    ]);

    expect(typeof seriesRes.count).toBe("number");
    expect(typeof novelRes.count).toBe("number");
    expect(typeof userRes.count).toBe("number");
    expect(userRes.count).toBeGreaterThanOrEqual(1);
  });

  it("finds the seed user by id via db.orm.public.User.first", async () => {
    const seedUserId = "00000000-0000-0000-0000-000000000001";
    const user = await db.orm.public.User.where({ id: seedUserId }).first();

    expect(user).toBeDefined();
    expect(user?.email).toBe("seed@inkstory.local");
    expect(user?.name).toBe("Seed User");
  });
});
