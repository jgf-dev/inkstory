import { describe, expect, it } from "vite-plus/test";
import {
  buildBetterStackInitScript,
  PRODUCTION_ANALYTICS_HOSTNAMES,
} from "../src/lib/analytics/betterstack";

describe("buildBetterStackInitScript", () => {
  it("returns null outside production builds", () => {
    expect(
      buildBetterStackInitScript({
        token: "TKXW6BinG9JpyjaRroQaZvnM",
        nodeEnv: "development",
      }),
    ).toBeNull();

    expect(
      buildBetterStackInitScript({
        token: "TKXW6BinG9JpyjaRroQaZvnM",
        nodeEnv: "test",
      }),
    ).toBeNull();

    expect(
      buildBetterStackInitScript({
        token: "TKXW6BinG9JpyjaRroQaZvnM",
        nodeEnv: undefined,
      }),
    ).toBeNull();
  });

  it("returns null in E2E mode even when NODE_ENV is production", () => {
    expect(
      buildBetterStackInitScript({
        token: "TKXW6BinG9JpyjaRroQaZvnM",
        nodeEnv: "production",
        isE2e: true,
      }),
    ).toBeNull();
  });

  it("returns null when token is missing, blank, or contains unsafe characters", () => {
    expect(buildBetterStackInitScript({ nodeEnv: "production" })).toBeNull();
    expect(buildBetterStackInitScript({ token: "   ", nodeEnv: "production" })).toBeNull();
    expect(
      buildBetterStackInitScript({
        token: "abc'</script><script>alert(1)</script>",
        nodeEnv: "production",
      }),
    ).toBeNull();
    expect(
      buildBetterStackInitScript({
        token: "token with spaces",
        nodeEnv: "production",
      }),
    ).toBeNull();
  });

  it("builds a valid async bootstrap snippet with hostname-based environment fallback", () => {
    const script = buildBetterStackInitScript({
      token: "  TKXW6BinG9JpyjaRroQaZvnM  ",
      nodeEnv: "production",
    });

    expect(script).not.toBeNull();
    expect(script).toContain("https://betterstack.net/b.js?t=");
    expect(script).toContain('"TKXW6BinG9JpyjaRroQaZvnM"');
    for (const host of PRODUCTION_ANALYTICS_HOSTNAMES) {
      expect(script).toContain(JSON.stringify(host));
    }

    // Verify the generated bootstrap executes cleanly and resolves hostnames as expected.
    const resolveEnvironmentForHost = (hostname: string): string => {
      const calls: unknown[][] = [];
      const appended: Array<{ src: string; async: number; crossOrigin: string }> = [];
      const win: Record<string, unknown> = {};
      const doc = {
        head: {
          appendChild: (node: { src: string; async: number; crossOrigin: string }) => {
            appended.push(node);
          },
        },
        createElement: () => ({ src: "", async: 0, crossOrigin: "" }),
      };

      const run = new Function(
        "window",
        "document",
        "location",
        "betterstack",
        `${script}; return window.betterstack.q;`,
      );
      const queued = run(win, doc, { hostname }, (...args: unknown[]) => calls.push(args)) as
        | unknown[][]
        | undefined;

      expect(appended).toHaveLength(1);
      expect(appended[0]?.src).toBe("https://betterstack.net/b.js?t=TKXW6BinG9JpyjaRroQaZvnM");
      expect(appended[0]?.async).toBe(1);
      expect(appended[0]?.crossOrigin).toBe("anonymous");

      const initCall = calls.find((c) => c[0] === "init") ?? queued?.find((c) => c[0] === "init");
      return (initCall?.[1] as { environment: string }).environment;
    };

    expect(resolveEnvironmentForHost("syncodex.xyz")).toBe("production");
    expect(resolveEnvironmentForHost("www.syncodex.xyz")).toBe("production");
    expect(resolveEnvironmentForHost("betterstack.pre.syncodex.xyz")).toBe("preview");
    expect(resolveEnvironmentForHost("betterstack-inkstory.jgeof.workers.dev")).toBe("preview");
    expect(resolveEnvironmentForHost("localhost")).toBe("development");
    expect(resolveEnvironmentForHost("127.0.0.1")).toBe("development");
  });

  it("uses an explicit environment override and escapes HTML/script breakout sequences", () => {
    const script = buildBetterStackInitScript({
      token: "TKXW6BinG9JpyjaRroQaZvnM",
      environment: "staging</script><!--\u2028\u2029tail",
      nodeEnv: "production",
    });

    expect(script).not.toBeNull();
    expect(script).not.toContain("</script>");
    expect(script).not.toContain("<!--");
    expect(script).not.toContain("\u2028");
    expect(script).not.toContain("\u2029");
    expect(script).toContain(
      "betterstack('init',{environment:\"staging\\u003c/script\\u003e\\u003c!--\\u2028\\u2029tail\"});",
    );
  });
});
