import { crc32 } from "../../src/lib/codex/interchange/png";

/** A valid 1×1 RGBA PNG. */
export const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
/** Latin-1 string → byte values. */
export function ascii(value: string): number[] {
  return Array.from({ length: value.length }, (_, i) => value.charCodeAt(i));
}

export const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

export function chunk(type: string, data: number[] | Uint8Array, badCrc = false): number[] {
  const typeBytes = ascii(type);
  const body = Uint8Array.from(data);
  const crc = crc32(Uint8Array.from(typeBytes), body);
  return [...u32(body.length), ...typeBytes, ...body, ...u32(badCrc ? crc ^ 1 : crc)];
}

export function ihdr(width = 1, height = 1): number[] {
  return chunk("IHDR", [...u32(width), ...u32(height), 8, 6, 0, 0, 0]);
}

export function text(keyword: string, value: string): number[] {
  return chunk("tEXt", ascii(`${keyword}\0${value}`));
}

export const IDAT = chunk("IDAT", [1, 2, 3]);
export const IEND = chunk("IEND", []);

export function png(...chunks: number[][]): Uint8Array {
  return Uint8Array.from([...SIG, ...chunks.flat()]);
}
