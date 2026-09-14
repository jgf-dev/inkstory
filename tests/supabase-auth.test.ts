import { afterAll, describe, expect, it } from "vite-plus/test";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { syncAuthUser } from "../src/lib/supabase/auth";
import { db } from "../src/lib/prisma";

describe("syncAuthUser", () => {
  const testUserId = "99999999-9999-9999-9999-999999999999";

  afterAll(async () => {
    try {
      await db.orm.public.User.where({ id: testUserId }).delete();
    } catch {
      // Ignore if not created
    }
  });

  it("throws an error when user has no email", async () => {
    const invalidUser = {
      id: testUserId,
      user_metadata: {},
      app_metadata: {},
      aud: "authenticated",
      created_at: new Date().toISOString(),
    } as unknown as SupabaseUser;

    await expect(syncAuthUser(invalidUser)).rejects.toThrow(
      "Supabase user has no email — cannot sync to local users table.",
    );
  });

  it("extracts full_name and avatar_url from user_metadata and upserts into database", async () => {
    const userWithFullName = {
      id: testUserId,
      email: "sync-test-1@inkstory.local",
      user_metadata: {
        full_name: "Arthur Pendragon",
        avatar_url: "https://inkstory.local/avatars/arthur.png",
      },
      app_metadata: {},
      aud: "authenticated",
      created_at: new Date().toISOString(),
    } as unknown as SupabaseUser;

    const result = await syncAuthUser(userWithFullName);
    expect(result).toBeDefined();

    const storedUser = await db.orm.public.User.where({ id: testUserId }).first();
    expect(storedUser).toBeDefined();
    expect(storedUser?.email).toBe("sync-test-1@inkstory.local");
    expect(storedUser?.name).toBe("Arthur Pendragon");
    expect(storedUser?.avatarUrl).toBe("https://inkstory.local/avatars/arthur.png");
  });

  it("falls back to metadata name and picture when full_name and avatar_url are omitted", async () => {
    const userWithFallback = {
      id: testUserId,
      email: "sync-test-2@inkstory.local",
      user_metadata: {
        name: "Guinevere",
        picture: "https://inkstory.local/avatars/guinevere.png",
      },
      app_metadata: {},
      aud: "authenticated",
      created_at: new Date().toISOString(),
    } as unknown as SupabaseUser;

    await syncAuthUser(userWithFallback);

    const storedUser = await db.orm.public.User.where({ id: testUserId }).first();
    expect(storedUser?.email).toBe("sync-test-2@inkstory.local");
    expect(storedUser?.name).toBe("Guinevere");
    expect(storedUser?.avatarUrl).toBe("https://inkstory.local/avatars/guinevere.png");
  });

  it("falls back to null when neither name nor avatar metadata is provided", async () => {
    const minimalUser = {
      id: testUserId,
      email: "sync-test-minimal@inkstory.local",
      user_metadata: {},
      app_metadata: {},
      aud: "authenticated",
      created_at: new Date().toISOString(),
    } as unknown as SupabaseUser;

    await syncAuthUser(minimalUser);

    const storedUser = await db.orm.public.User.where({ id: testUserId }).first();
    expect(storedUser?.email).toBe("sync-test-minimal@inkstory.local");
    expect(storedUser?.name).toBeNull();
    expect(storedUser?.avatarUrl).toBeNull();
  });
});
