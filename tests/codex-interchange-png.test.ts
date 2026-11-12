import { describe, expect, it } from "vite-plus/test";
import {
  base64ToBytes,
  base64ToUtf8,
  bytesToBase64,
  crc32,
  embedCardText,
  extractCardText,
  readPng,
  utf8ToBase64,
} from "../src/lib/codex/interchange/png";
import { CARD_LIMITS } from "../src/lib/codex/interchange/types";
import { IDAT, IEND, TINY_PNG_B64, ascii, chunk, ihdr, png, text, u32 } from "./fixtures/png";

describe("PNG card metadata (STO-1263)", () => {
  it("reads a real PNG and computes standard CRC-32", () => {
    const parsed = readPng(base64ToBytes(TINY_PNG_B64, "png"));
    expect(parsed).toMatchObject({ width: 1, height: 1 });
    expect(parsed.chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("rejects malformed, truncated or oversized PNGs", () => {
    const cases: Array<[Uint8Array, RegExp]> = [
      [Uint8Array.from([1, 2, 3]), /not a PNG/],
      [png(ihdr(), IDAT), /no IEND/],
      [png(ihdr(), IDAT, IEND).slice(0, -3), /truncated/],
      [png(ihdr(), IDAT, IEND, [0]), /after the IEND/],
      [png(ihdr(), IEND), /no image data/],
      [png(IDAT, IEND), /must start with an IHDR/],
      [png(ihdr(), ihdr(), IDAT, IEND), /more than one IHDR/],
      [png(ihdr(0, 1), IDAT, IEND), /dimensions/],
      [png(ihdr(9000, 1), IDAT, IEND), /dimensions/],
      [png(ihdr(8192, 8192), IDAT, IEND), /dimensions/],
      [png(ihdr(), chunk("IDAT", [1], true), IEND), /bad checksum/],
      [png(ihdr(), chunk("ID1T", [1]), IEND), /invalid chunk type/],
      [png(ihdr(), [...u32(0x80000000), 73, 68, 65, 84]), /truncated/],
    ];
    for (const [bytes, message] of cases) {
      expect(() => readPng(bytes)).toThrow(message);
    }
    expect(() => readPng(new Uint8Array(CARD_LIMITS.maxPngBytes + 1))).toThrow(/exceeds/);
    const many = Array.from({ length: CARD_LIMITS.maxPngChunks }, () => IDAT);
    expect(() => readPng(png(ihdr(), ...many, IEND))).toThrow(/more than 4096 chunks/);
  });

  it("extracts card text, preferring ccv3 over chara", () => {
    expect(extractCardText(readPng(png(ihdr(), text("chara", "QQ=="), IDAT, IEND)))).toEqual({
      keyword: "chara",
      text: "QQ==",
    });
    const both = png(ihdr(), text("chara", "QQ=="), text("ccv3", "Qg=="), IDAT, IEND);
    expect(extractCardText(readPng(both)).keyword).toBe("ccv3");
    const dup = png(ihdr(), text("chara", "QQ=="), text("chara", "QQ=="), IDAT, IEND);
    expect(extractCardText(readPng(dup)).text).toBe("QQ==");
  });

  it("rejects missing, conflicting, compressed or oversized card metadata", () => {
    expect(() => extractCardText(readPng(png(ihdr(), text("Title", "x"), IDAT, IEND)))).toThrow(
      /no character card metadata/,
    );
    const conflict = png(ihdr(), text("chara", "QQ=="), text("chara", "Qg=="), IDAT, IEND);
    expect(() => extractCardText(readPng(conflict))).toThrow(/conflicting/);
    const ztxt = chunk("zTXt", [...ascii("chara\0\0"), 120, 156]);
    expect(() => extractCardText(readPng(png(ihdr(), ztxt, IDAT, IEND)))).toThrow(
      /zTXt chunk is not supported/,
    );
    const huge = "A".repeat(CARD_LIMITS.maxCardTextBytes + 1);
    expect(() => extractCardText(readPng(png(ihdr(), text("chara", huge), IDAT, IEND)))).toThrow(
      /exceeds/,
    );
  });

  it("embeds a single chara chunk before IEND and keeps image chunks", () => {
    const source = readPng(
      png(ihdr(), text("chara", "b2xk"), text("ccv3", "b2xk"), text("Title", "keep"), IDAT, IEND),
    );
    const card = JSON.stringify({ spec: "chara_card_v2", data: { name: "Mara ✨" } });
    const out = readPng(embedCardText(source, utf8ToBase64(card)));
    expect(out.chunks.map((c) => c.type)).toEqual(["IHDR", "tEXt", "IDAT", "tEXt", "IEND"]);
    const extracted = extractCardText(out);
    expect(extracted.keyword).toBe("chara");
    expect(base64ToUtf8(extracted.text, "card")).toBe(card);
    expect(() => embedCardText(source, "not base64!")).toThrow(/must be base64/);
  });

  it("round-trips base64 helpers and rejects bad input", () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(bytes), "x")).toEqual(bytes);
    expect(() => base64ToBytes("@@@", "Blob")).toThrow(/Blob is not valid base64/);
    expect(() => base64ToUtf8(bytesToBase64(Uint8Array.from([0xff, 0xfe])), "Blob")).toThrow(
      /not valid UTF-8/,
    );
  });
});
