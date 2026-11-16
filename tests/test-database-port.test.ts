import { describe, expect, it } from "vite-plus/test";
import {
  SAFE_TEST_DATABASE_ERROR,
  assertSafeTestDatabaseEnv,
} from "../src/lib/test-database-guard";
import {
  DEFAULT_TEST_POSTGRES_PORT,
  TEST_POSTGRES_PORT_ENV,
  applyTestPostgresPortToEnv,
  parseTestPostgresPort,
  resolveTestPostgresPort,
  rewriteDatabaseUrlPort,
  takePortFlag,
} from "../src/lib/test-database-port";

describe("parseTestPostgresPort", () => {
  it("defaults to 5432 when the value is missing or blank", () => {
    expect(parseTestPostgresPort(undefined)).toBe(DEFAULT_TEST_POSTGRES_PORT);
    expect(parseTestPostgresPort("")).toBe(DEFAULT_TEST_POSTGRES_PORT);
    expect(parseTestPostgresPort("   ")).toBe(DEFAULT_TEST_POSTGRES_PORT);
  });

  it.each(["1", "5432", "55432", "65535", " 55432 "])("accepts %s", (raw) => {
    expect(parseTestPostgresPort(raw)).toBe(Number(raw.trim()));
  });

  it.each(["0", "65536", "-1", "5432.5", "1e3", "55432a", "plus5432", "+5432", "0x1538"])(
    "rejects %s",
    (raw) => {
      expect(() => parseTestPostgresPort(raw)).toThrowError(
        /INKSTORY_TEST_POSTGRES_PORT must be an integer from 1 to 65535/,
      );
    },
  );

  it("uses the provided label in the error", () => {
    expect(() => parseTestPostgresPort("99999", "--port")).toThrowError(
      /--port must be an integer from 1 to 65535 \(got "99999"\)/,
    );
  });
});

describe("rewriteDatabaseUrlPort", () => {
  it("rewrites a localhost URL from 5432 to the chosen port", () => {
    expect(
      rewriteDatabaseUrlPort("postgresql://postgres:postgres@localhost:5432/inkstory_test", 55432),
    ).toBe("postgresql://postgres:postgres@localhost:55432/inkstory_test");
  });

  it("rewrites 127.0.0.1 and IPv6 loopback URLs", () => {
    expect(
      rewriteDatabaseUrlPort("postgres://postgres:postgres@127.0.0.1:5432/inkstory_test", 55432),
    ).toBe("postgres://postgres:postgres@127.0.0.1:55432/inkstory_test");
    expect(
      rewriteDatabaseUrlPort("postgresql://postgres:postgres@[::1]:5432/inkstory_test", 55432),
    ).toBe("postgresql://postgres:postgres@[::1]:55432/inkstory_test");
  });

  it("adds the port when the URL has none and preserves query strings", () => {
    expect(
      rewriteDatabaseUrlPort("postgresql://postgres:postgres@localhost/inkstory_test", 55432),
    ).toBe("postgresql://postgres:postgres@localhost:55432/inkstory_test");
    expect(
      rewriteDatabaseUrlPort(
        "postgresql://postgres:postgres@localhost:5432/inkstory_test?sslmode=disable",
        55432,
      ),
    ).toBe("postgresql://postgres:postgres@localhost:55432/inkstory_test?sslmode=disable");
  });

  it("rejects an invalid URL", () => {
    expect(() => rewriteDatabaseUrlPort("not-a-url", 55432)).toThrowError(
      /Cannot rewrite port on invalid database URL/,
    );
  });
});

describe("applyTestPostgresPortToEnv", () => {
  it("rewrites both URLs and records the chosen port so Compose can use it", () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/inkstory_test",
      DIRECT_URL: "postgresql://postgres:postgres@localhost:5432/inkstory_test",
    };

    applyTestPostgresPortToEnv(env, 55432);

    expect(env.DATABASE_URL).toBe("postgresql://postgres:postgres@localhost:55432/inkstory_test");
    expect(env.DIRECT_URL).toBe("postgresql://postgres:postgres@localhost:55432/inkstory_test");
    expect(env[TEST_POSTGRES_PORT_ENV]).toBe("55432");
    expect(() => assertSafeTestDatabaseEnv(env)).not.toThrow();
  });

  it("leaves blank URLs alone so the guard can still allow unit tests without a database", () => {
    const env: Record<string, string | undefined> = { DATABASE_URL: "", DIRECT_URL: "   " };
    applyTestPostgresPortToEnv(env, 55432);
    expect(env.DATABASE_URL).toBe("");
    expect(env.DIRECT_URL).toBe("   ");
    expect(env[TEST_POSTGRES_PORT_ENV]).toBe("55432");
  });

  it("does not let a port rewrite bypass the safety guard", () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: "postgresql://postgres:postgres@wntgnjrrzfndunqaiobo.supabase.co:5432/postgres",
    };
    applyTestPostgresPortToEnv(env, 55432);
    expect(env.DATABASE_URL).toContain(":55432/");
    expect(() => assertSafeTestDatabaseEnv(env)).toThrowError(SAFE_TEST_DATABASE_ERROR);
  });
});

describe("takePortFlag", () => {
  it("leaves argv unchanged when no port flag is present", () => {
    expect(takePortFlag(["--coverage", "tests/foo.test.ts"])).toEqual({
      flag: undefined,
      rest: ["--coverage", "tests/foo.test.ts"],
    });
  });

  it("accepts --port and --port= and forwards remaining args to Vitest", () => {
    expect(takePortFlag(["--port", "55432", "--coverage"])).toEqual({
      flag: "55432",
      rest: ["--coverage"],
    });
    expect(takePortFlag(["--port=55432", "tests/foo.test.ts"])).toEqual({
      flag: "55432",
      rest: ["tests/foo.test.ts"],
    });
  });

  it("uses the last --port flag when more than one is given", () => {
    expect(takePortFlag(["--port", "5432", "--port=55432"])).toEqual({
      flag: "55432",
      rest: [],
    });
  });

  it("rejects a missing or flag-like --port value", () => {
    expect(() => takePortFlag(["--port"])).toThrowError(
      /--port must be an integer from 1 to 65535/,
    );
    expect(() => takePortFlag(["--port", "--coverage"])).toThrowError(
      /--port must be an integer from 1 to 65535/,
    );
  });

  it("does not treat --portable as a port flag", () => {
    expect(takePortFlag(["--portable", "1"])).toEqual({
      flag: undefined,
      rest: ["--portable", "1"],
    });
  });
});

describe("resolveTestPostgresPort", () => {
  it("prefers --port over INKSTORY_TEST_POSTGRES_PORT", () => {
    expect(resolveTestPostgresPort("55432", "5432")).toBe(55432);
  });

  it("uses the env var when no flag is given, then the default", () => {
    expect(resolveTestPostgresPort(undefined, "55432")).toBe(55432);
    expect(resolveTestPostgresPort(undefined, undefined)).toBe(DEFAULT_TEST_POSTGRES_PORT);
    expect(resolveTestPostgresPort(undefined, "")).toBe(DEFAULT_TEST_POSTGRES_PORT);
  });

  it("rejects an empty or invalid --port even when the env var is valid", () => {
    expect(() => resolveTestPostgresPort("", "55432")).toThrowError(/--port/);
    expect(() => resolveTestPostgresPort("0", "55432")).toThrowError(/--port/);
  });
});
