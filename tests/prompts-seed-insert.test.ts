import { describe, expect, it, vi } from "vite-plus/test";
import { insertSeedRow } from "../src/lib/prompts/seed-insert";

function uniqueViolation(message: string, cause?: unknown): Error & { code: string } {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), {
    code: "23505",
  });
}

describe("insertSeedRow (STO-1289)", () => {
  it("does not re-check existence when the insert succeeds", async () => {
    const insert = vi.fn(async () => ({ id: "row" }));
    const exists = vi.fn(async () => true);

    await expect(insertSeedRow(insert, exists)).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledOnce();
    expect(exists).not.toHaveBeenCalled();
  });

  it("swallows a duplicate-key failure when a concurrent caller created the row", async () => {
    const duplicate = uniqueViolation(
      'duplicate key value violates unique constraint "prompt_components_pkey"',
    );
    const insert = vi.fn(async () => {
      throw duplicate;
    });
    const exists = vi.fn(async () => true);

    await expect(insertSeedRow(insert, exists)).resolves.toBeUndefined();
    expect(exists).toHaveBeenCalledOnce();
  });

  it("swallows a unique violation wrapped as the error's cause", async () => {
    const duplicate = uniqueViolation(
      'duplicate key value violates unique constraint "prompt_components_pkey"',
    );
    const wrapped = new Error("insert failed", { cause: duplicate });
    const insert = vi.fn(async () => {
      throw wrapped;
    });
    const exists = vi.fn(async () => true);

    await expect(insertSeedRow(insert, exists)).resolves.toBeUndefined();
    expect(exists).toHaveBeenCalledOnce();
  });

  it("rethrows a non-conflict error even when the row exists", async () => {
    const failure = new Error("connection reset");
    const insert = vi.fn(async () => {
      throw failure;
    });
    const exists = vi.fn(async () => true);

    await expect(insertSeedRow(insert, exists)).rejects.toBe(failure);
    expect(exists).not.toHaveBeenCalled();
  });

  it("rethrows a unique violation when the row is still missing", async () => {
    const failure = uniqueViolation(
      'duplicate key value violates unique constraint "prompt_components_pkey"',
    );
    const insert = vi.fn(async () => {
      throw failure;
    });
    const exists = vi.fn(async () => false);

    await expect(insertSeedRow(insert, exists)).rejects.toBe(failure);
    expect(exists).toHaveBeenCalledOnce();
  });
});
