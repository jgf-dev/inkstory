import { describe, expect, it } from "vite-plus/test";
import {
  SAFE_TEST_DATABASE_ERROR,
  assertSafeTestDatabaseEnv,
  assertSafeTestDatabaseUrl,
} from "../src/lib/test-database-guard";

function expectUnsafe(raw: string | undefined, label?: string): void {
  expect(() => assertSafeTestDatabaseUrl(raw, label)).toThrowError(SAFE_TEST_DATABASE_ERROR);
}

describe("assertSafeTestDatabaseUrl", () => {
  it("allows missing or blank values so unit tests can run without a database", () => {
    expect(() => assertSafeTestDatabaseUrl(undefined)).not.toThrow();
    expect(() => assertSafeTestDatabaseUrl("")).not.toThrow();
    expect(() => assertSafeTestDatabaseUrl("   ")).not.toThrow();
  });

  it.each([
    "postgresql://postgres:postgres@localhost:5432/inkstory_test",
    "postgres://postgres:postgres@127.0.0.1:5432/inkstory_test",
    "postgresql://postgres:postgres@[::1]:5432/inkstory_test",
    "postgresql://postgres:postgres@LocalHost:5432/inkstory_test",
    "postgres://postgres:postgres@127.0.0.1:1/x",
  ])("allows loopback URL %s", (url) => {
    expect(() => assertSafeTestDatabaseUrl(url)).not.toThrow();
  });

  it("rejects prod and preview Supabase project refs even on a loopback host", () => {
    expectUnsafe("postgresql://postgres.wntgnjrrzfndunqaiobo:secret@localhost:5432/postgres");
    expectUnsafe(
      "postgresql://postgres:postgres@127.0.0.1:5432/postgres?options=oobhhexdoufnwdltoren",
    );
    expectUnsafe("postgresql://postgres:postgres@wntgnjrrzfndunqaiobo.supabase.co:5432/postgres");
    expectUnsafe("postgresql://postgres:postgres@oobhhexdoufnwdltoren.supabase.co:5432/postgres");
  });

  it("rejects non-local hosts", () => {
    expectUnsafe("postgresql://postgres:postgres@db.example.com:5432/inkstory_test");
    expectUnsafe(
      "postgresql://postgres:postgres@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
    );
    expectUnsafe("postgresql://postgres:postgres@10.0.0.5:5432/inkstory_test");
    expectUnsafe("postgresql://postgres:postgres@172.17.0.2:5432/inkstory_test");
    expectUnsafe("postgresql://postgres:postgres@postgres:5432/inkstory_test");
    expectUnsafe("postgresql://postgres:postgres@localhost.internal:5432/inkstory_test");
    expectUnsafe("postgresql://postgres:postgres@0.0.0.0:5432/inkstory_test");
  });

  it("rejects invalid URLs and non-postgres protocols", () => {
    expectUnsafe("not-a-url");
    expectUnsafe("https://localhost:5432/inkstory_test");
    expectUnsafe("mysql://postgres:postgres@localhost:5432/inkstory_test");
  });

  it("uses the provided label in the error", () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgresql://postgres:postgres@db.example.com:5432/x",
        "DIRECT_URL",
      ),
    ).toThrowError(/DIRECT_URL/);
  });
});

describe("assertSafeTestDatabaseEnv", () => {
  it("allows an env with no database URLs", () => {
    expect(() => assertSafeTestDatabaseEnv({})).not.toThrow();
  });

  it("allows CI-style loopback URLs on both variables", () => {
    expect(() =>
      assertSafeTestDatabaseEnv({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/inkstory_test",
        DIRECT_URL: "postgresql://postgres:postgres@localhost:5432/inkstory_test",
      }),
    ).not.toThrow();
  });

  it("rejects when either URL is unsafe", () => {
    expect(() =>
      assertSafeTestDatabaseEnv({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/inkstory_test",
        DIRECT_URL: "postgresql://postgres:postgres@wntgnjrrzfndunqaiobo.supabase.co:5432/postgres",
      }),
    ).toThrowError(/DIRECT_URL/);

    expect(() =>
      assertSafeTestDatabaseEnv({
        DATABASE_URL: "postgresql://postgres:postgres@db.example.com:5432/inkstory_test",
      }),
    ).toThrowError(/DATABASE_URL/);
  });
});
