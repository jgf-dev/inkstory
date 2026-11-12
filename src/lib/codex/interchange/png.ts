/**
 * Minimal, bounded PNG chunk reader/writer for Character Card metadata
 * (STO-1263). Pure: no DB, auth or network access, and no pixel decoding.
 *
 * Only uncompressed `tEXt` chunks with the `chara` (V2) or `ccv3` (V3) keyword
 * are read. Compressed (`zTXt`) or international (`iTXt`) card metadata is
 * rejected rather than inflated, so there is no decompression-bomb surface.
 * Every chunk's length and CRC is checked, and nothing may follow `IEND`.
 */

import { CARD_LIMITS } from "./types";
import { invalid } from "./validate";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const CARD_KEYWORDS = new Set(["chara", "ccv3"]);
const TEXT_CHUNKS = new Set(["tEXt", "zTXt", "iTXt"]);

export interface PngChunk {
  type: string;
  data: Uint8Array;
  /** The full chunk bytes (length + type + data + CRC) as read. */
  raw: Uint8Array;
}

export interface ParsedPng {
  width: number;
  height: number;
  chunks: PngChunk[];
}

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** CRC-32 (ISO 3309) as used by PNG, over the chunk type and data. */
export function crc32(...parts: Uint8Array[]): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      crc = table[(crc ^ part[i]!) & 0xff]! ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

/**
 * Parses and validates PNG structure within CARD_LIMITS. Throws 422
 * VALIDATION_FAILED for anything malformed, truncated or oversized.
 */
export function readPng(bytes: Uint8Array): ParsedPng {
  if (bytes.length > CARD_LIMITS.maxPngBytes) {
    throw invalid(`PNG exceeds ${CARD_LIMITS.maxPngBytes} bytes`);
  }
  if (bytes.length < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw invalid("File is not a PNG image");
  }

  const chunks: PngChunk[] = [];
  let offset: number = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let sawIdat = false;
  let sawIend = false;

  while (offset < bytes.length) {
    if (chunks.length >= CARD_LIMITS.maxPngChunks) {
      throw invalid(`PNG has more than ${CARD_LIMITS.maxPngChunks} chunks`);
    }
    if (offset + 12 > bytes.length) {
      throw invalid("PNG is truncated");
    }
    const length = readU32(bytes, offset);
    const end = offset + 12 + length;
    if (length > 0x7fffffff || end > bytes.length) {
      throw invalid("PNG is truncated");
    }
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = latin1(typeBytes);
    if (!/^[A-Za-z]{4}$/.test(type)) {
      throw invalid("PNG has an invalid chunk type");
    }
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(typeBytes, data) !== readU32(bytes, offset + 8 + length)) {
      throw invalid(`PNG chunk ${type} has a bad checksum`);
    }

    if (chunks.length === 0) {
      if (type !== "IHDR" || length !== 13) {
        throw invalid("PNG must start with an IHDR chunk");
      }
      width = readU32(data, 0);
      height = readU32(data, 4);
      if (
        width === 0 ||
        height === 0 ||
        width > CARD_LIMITS.maxPngDimension ||
        height > CARD_LIMITS.maxPngDimension ||
        width * height > CARD_LIMITS.maxPngPixels
      ) {
        throw invalid(
          `PNG dimensions must be between 1 and ${CARD_LIMITS.maxPngDimension} pixels per side`,
        );
      }
    } else if (type === "IHDR") {
      throw invalid("PNG has more than one IHDR chunk");
    }
    if (type === "IDAT") sawIdat = true;

    chunks.push({ type, data, raw: bytes.subarray(offset, end) });
    offset = end;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }

  if (!sawIend) throw invalid("PNG is truncated (no IEND chunk)");
  if (offset !== bytes.length) throw invalid("PNG has data after the IEND chunk");
  if (!sawIdat) throw invalid("PNG has no image data");
  return { width, height, chunks };
}

function textKeyword(chunk: PngChunk): string | null {
  if (!TEXT_CHUNKS.has(chunk.type)) return null;
  const sep = chunk.data.indexOf(0);
  if (sep <= 0 || sep > 79) return null;
  return latin1(chunk.data.subarray(0, sep));
}

export interface PngCardText {
  keyword: "chara" | "ccv3";
  /** Base64 text exactly as stored in the chunk. */
  text: string;
}

/**
 * Finds the card payload. Like SillyTavern, a `ccv3` chunk wins over `chara`.
 * Duplicate chunks with different content, or card metadata stored in a
 * compressed/international text chunk, are rejected.
 */
export function extractCardText(png: ParsedPng): PngCardText {
  const found = new Map<string, string>();
  for (const chunk of png.chunks) {
    const keyword = textKeyword(chunk);
    if (!keyword || !CARD_KEYWORDS.has(keyword)) continue;
    if (chunk.type !== "tEXt") {
      throw invalid(
        `Card metadata in a ${chunk.type} chunk is not supported; only uncompressed tEXt is read`,
      );
    }
    const textBytes = chunk.data.subarray(keyword.length + 1);
    if (textBytes.length > CARD_LIMITS.maxCardTextBytes) {
      throw invalid(`Card metadata exceeds ${CARD_LIMITS.maxCardTextBytes} bytes`);
    }
    const text = latin1(textBytes);
    const previous = found.get(keyword);
    if (previous !== undefined && previous !== text) {
      throw invalid(`PNG has conflicting "${keyword}" card metadata chunks`);
    }
    found.set(keyword, text);
  }
  const v3 = found.get("ccv3");
  if (v3 !== undefined) return { keyword: "ccv3", text: v3 };
  const v2 = found.get("chara");
  if (v2 !== undefined) return { keyword: "chara", text: v2 };
  throw invalid("PNG has no character card metadata (no chara or ccv3 tEXt chunk)");
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from({ length: type.length }, (_, i) => type.charCodeAt(i));
  const out = new Uint8Array(12 + data.length);
  writeU32(out, 0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  writeU32(out, 8 + data.length, crc32(typeBytes, data));
  return out;
}

/**
 * Returns a copy of an author-supplied PNG with any existing card metadata
 * removed and a single `chara` tEXt chunk (base64 card JSON) inserted before
 * IEND. All image chunks are copied byte-for-byte.
 */
export function embedCardText(png: ParsedPng, base64Card: string): Uint8Array {
  if (!/^[A-Za-z0-9+/=]*$/.test(base64Card)) {
    throw invalid("Card text must be base64");
  }
  const payload = new Uint8Array(6 + base64Card.length);
  payload.set([99, 104, 97, 114, 97, 0]); // "chara\0"
  for (let i = 0; i < base64Card.length; i++) payload[6 + i] = base64Card.charCodeAt(i);
  const cardChunk = makeChunk("tEXt", payload);

  const kept = png.chunks.filter((chunk) => {
    const keyword = textKeyword(chunk);
    return !(keyword && CARD_KEYWORDS.has(keyword));
  });
  const parts: Uint8Array[] = [Uint8Array.from(PNG_SIGNATURE)];
  for (const chunk of kept) {
    if (chunk.type === "IEND") parts.push(cardChunk);
    parts.push(chunk.raw);
  }
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** UTF-8 text → base64 (chunked so large cards don't overflow the call stack). */
export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** Strict-enough base64 → bytes. Throws 422 on invalid input. */
export function base64ToBytes(text: string, label: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(text.replace(/\s+/g, ""));
  } catch {
    throw invalid(`${label} is not valid base64`);
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** base64 → UTF-8 text (fatal on invalid UTF-8). */
export function base64ToUtf8(text: string, label: string): string {
  const bytes = base64ToBytes(text, label);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalid(`${label} is not valid UTF-8`);
  }
}
