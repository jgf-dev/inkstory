import { describe, expect, it } from "vite-plus/test";
import { GET, dynamic } from "../src/app/api/health/route";

describe("GET /api/health", () => {
  it("exports dynamic configuration as force-dynamic", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns a 200 Response with expected JSON payload", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const data = await response.json();
    expect(data.status).toBe("ok");
    expect(data.service).toBe("inkstory");
    expect(typeof data.version).toBe("string");
    expect(typeof data.time).toBe("string");

    const parsedDate = new Date(data.time);
    expect(Number.isNaN(parsedDate.getTime())).toBe(false);
  });

  it("falls back to 0.1.0 if npm_package_version is unset", async () => {
    const originalVersion = process.env.npm_package_version;
    delete process.env.npm_package_version;

    try {
      const response = await GET();
      const data = await response.json();
      expect(data.version).toBe("0.1.0");
    } finally {
      if (originalVersion !== undefined) {
        process.env.npm_package_version = originalVersion;
      }
    }
  });
});
