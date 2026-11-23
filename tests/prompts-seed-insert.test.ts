import { describe, expect, it, vi } from "vite-plus/test";
import { insertSeedRow } from "../src/lib/prompts/seed-insert";

describe("insertSeedRow (STO-1289)", () => {
  it("does not re-check existence when the insert succeeds", async () => {
    const insert = vi.fn(async () => ({ id: "row" }));
    const exists = vi.fn(async () => true);

    await expect(insertSeedRow(insert, exists)).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledOnce();
    expect(exists).not.toHaveBeenCalled();
  });

  it("swallows a duplicate-key failure when a concurrent caller created the row", async () => {
    const duplicate = new Error(
      'duplicate key value violates unique constraint "prompt_components_pkey"',
    );
    const insert = vi.fn(async () => {
      throw duplicate;
    });
    const exists = vi.fn(async () => true);

    await expect(insertSeedRow(insert, exists)).resolves.toBeUndefined();
    expect(exists).toHaveBeenCalledOnce();
  });

  it("rethrows the original error when the row is still missing", async () => {
    const failure = new Error("connection reset");
    const insert = vi.fn(async () => {
      throw failure;
    });
    const exists = vi.fn(async () => false);

    await expect(insertSeedRow(insert, exists)).rejects.toBe(failure);
    expect(exists).toHaveBeenCalledOnce();
  });
});
