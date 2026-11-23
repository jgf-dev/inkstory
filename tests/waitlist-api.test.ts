import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { POST } from "../src/app/api/waitlist/route";
import { db } from "../src/lib/prisma";
import {
  addWaitlistSignup,
  WAITLIST_BODY_MAX_LENGTH,
  WAITLIST_HONEYPOT_FIELD,
  WAITLIST_SUCCESS_MESSAGE,
} from "../src/lib/waitlist";
import * as waitlistService from "../src/lib/waitlist/service";

const runId = crypto.randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}-${runId}@waitlist.inkstory.local`;

function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new NextRequest("http://localhost:3000/api/waitlist", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...headers },
    }),
  );
}

async function rowsFor(email: string) {
  return db.orm.public.WaitlistSignup.where({ email }).all();
}

describe("waitlist signups", { timeout: 20_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for (const name of ["new", "dup", "race", "svc", "referrer"]) {
      await db.orm.public.WaitlistSignup.where({ email: emailFor(name) }).deleteAll();
    }
  });

  it("stores a normalized signup with source and referrer", async () => {
    const res = await post(
      JSON.stringify({ email: `  ${emailFor("NEW").toUpperCase()} `, source: "Newsletter" }),
      { referer: "https://syncodex.xyz/" },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: WAITLIST_SUCCESS_MESSAGE });
    const rows = await rowsFor(emailFor("new"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: emailFor("new"),
      source: "newsletter",
      referrer: "https://syncodex.xyz/",
    });
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0].createdAt).toBeDefined();
  });

  it("answers a duplicate exactly like a new signup and keeps one row", async () => {
    const first = await post(JSON.stringify({ email: emailFor("dup") }));
    const second = await post(JSON.stringify({ email: emailFor("DUP").toUpperCase() }));

    expect(second.status).toBe(first.status);
    expect(await second.json()).toEqual(await first.json());
    expect(await rowsFor(emailFor("dup"))).toHaveLength(1);
  });

  it("tolerates concurrent signups for the same email", async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => post(JSON.stringify({ email: emailFor("race") }))),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await rowsFor(emailFor("race"))).toHaveLength(1);
  });

  it("reports from the service whether a row was inserted", async () => {
    const signup = { email: emailFor("svc"), source: null, referrer: null };
    await expect(addWaitlistSignup(signup)).resolves.toBe(true);
    await expect(addWaitlistSignup(signup)).resolves.toBe(false);
  });

  it("returns success for a filled honeypot without storing anything", async () => {
    const spy = vi.spyOn(waitlistService, "addWaitlistSignup");
    const email = emailFor("honeypot");
    const res = await post(JSON.stringify({ email, [WAITLIST_HONEYPOT_FIELD]: "http://spam" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: WAITLIST_SUCCESS_MESSAGE });
    expect(spy).not.toHaveBeenCalled();
    expect(await rowsFor(email)).toHaveLength(0);
  });

  it("rejects an invalid email with 400", async () => {
    const res = await post(JSON.stringify({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rejects malformed JSON with 400 INVALID_JSON", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_JSON" });
  });

  it("rejects an oversized body with 413", async () => {
    const res = await post(JSON.stringify({ email: "a".repeat(WAITLIST_BODY_MAX_LENGTH) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects a declared Content-Length over the cap before reading the body", async () => {
    const res = await post(JSON.stringify({ email: emailFor("declared") }), {
      "content-length": String(WAITLIST_BODY_MAX_LENGTH + 1),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(await rowsFor(emailFor("declared"))).toHaveLength(0);
  });

  it("stops reading a streamed body without Content-Length once it passes the cap", async () => {
    const chunk = new TextEncoder().encode("a".repeat(1024));
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
      },
    });
    const res = await POST(
      new NextRequest("http://localhost:3000/api/waitlist", {
        method: "POST",
        body: stream,
        headers: { "content-type": "application/json" },
        duplex: "half",
      } as ConstructorParameters<typeof NextRequest>[1]),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(pulls).toBeLessThan(20);
  });

  it("returns a generic 500 when storage fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(waitlistService, "addWaitlistSignup").mockRejectedValue(new Error("db down"));
    const res = await post(JSON.stringify({ email: emailFor("broken") }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Something went wrong. Please try again.",
      code: "INTERNAL_ERROR",
    });
  });
});
