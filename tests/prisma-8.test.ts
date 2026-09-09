import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/lib/prisma";

describe("Prisma 8 Database Integration", () => {
  after(async () => {
    await db.close();
  });

  it("queries count aggregates on models via db.orm", async () => {
    const [seriesRes, novelRes, userRes] = await Promise.all([
      db.orm.public.Series.aggregate((a) => ({ count: a.count() })),
      db.orm.public.Novel.aggregate((a) => ({ count: a.count() })),
      db.orm.public.User.aggregate((a) => ({ count: a.count() })),
    ]);

    assert.equal(typeof seriesRes.count, "number");
    assert.equal(typeof novelRes.count, "number");
    assert.equal(typeof userRes.count, "number");
    assert.ok(userRes.count >= 1, "Expected at least 1 user after seeding");
  });

  it("finds the seed user by id via db.orm.public.User.first", async () => {
    const seedUserId = "00000000-0000-0000-0000-000000000001";
    const user = await db.orm.public.User.where({ id: seedUserId }).first();

    assert.ok(user, "Seed user should exist");
    assert.equal(user.email, "seed@inkstory.local");
    assert.equal(user.name, "Seed User");
  });
});
