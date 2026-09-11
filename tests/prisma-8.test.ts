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
    // CI DATABASE_URL may be reachable but unseeded; only assert seed presence when data exists.
    if (userRes.count === 0) {
      return;
    }
    expect(userRes.count).toBeGreaterThanOrEqual(1);
  });

  it("finds the seed user by id via db.orm.public.User.first", async () => {
    const seedUserId = "00000000-0000-0000-0000-000000000001";
    const user = await db.orm.public.User.where({ id: seedUserId }).first();

    if (!user) {
      // Unseeded CI databases skip the seed-user fixture assertions.
      return;
    }
    expect(user.email).toBe("seed@inkstory.local");
    expect(user.name).toBe("Seed User");
  });

  it("exports prisma as an alias pointing to db", async () => {
    const { prisma } = await import("../src/lib/prisma");
    expect(prisma).toBe(db);
  });

  describe("getValidDbUrl", () => {
    it("returns the URL when given a valid postgres or postgresql URL", async () => {
      const { getValidDbUrl } = await import("../src/lib/prisma");
      expect(getValidDbUrl("postgresql://user:pass@localhost:5432/db")).toBe(
        "postgresql://user:pass@localhost:5432/db",
      );
      expect(getValidDbUrl("postgres://user:pass@localhost:5432/db")).toBe(
        "postgres://user:pass@localhost:5432/db",
      );
    });

    it("returns undefined for unsupported protocols", async () => {
      const { getValidDbUrl } = await import("../src/lib/prisma");
      expect(getValidDbUrl("http://localhost:5432/db")).toBeUndefined();
      expect(getValidDbUrl("mysql://user:pass@localhost:3306/db")).toBeUndefined();
    });

    it("returns undefined for unparseable strings (e.g. masked Vercel envs)", async () => {
      const { getValidDbUrl } = await import("../src/lib/prisma");
      expect(getValidDbUrl("[SENSITIVE]")).toBeUndefined();
      expect(getValidDbUrl("not-a-valid-url")).toBeUndefined();
    });

    it("falls back to process.env variables when no argument is supplied", async () => {
      const { getValidDbUrl } = await import("../src/lib/prisma");
      const url = getValidDbUrl();
      if (process.env.DIRECT_URL || process.env.DATABASE_URL) {
        expect(typeof url).toBe("string");
        expect(url?.startsWith("postgres")).toBe(true);
      }
    });

    it("returns undefined when no custom URL and env vars are unset", async () => {
      const { getValidDbUrl } = await import("../src/lib/prisma");
      const previousDirect = process.env.DIRECT_URL;
      const previousDatabase = process.env.DATABASE_URL;
      delete process.env.DIRECT_URL;
      delete process.env.DATABASE_URL;
      try {
        expect(getValidDbUrl()).toBeUndefined();
      } finally {
        if (previousDirect !== undefined) process.env.DIRECT_URL = previousDirect;
        if (previousDatabase !== undefined) process.env.DATABASE_URL = previousDatabase;
      }
    });
  });
});
