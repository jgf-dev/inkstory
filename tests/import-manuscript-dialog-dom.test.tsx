// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ImportManuscriptDialog,
  IMPORT_ACCEPT,
} from "../src/app/dashboard/novels/[id]/_components/ImportManuscriptDialog";
import type { ImportPreview } from "../src/lib/import/types";

function makePreview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    title: "The Glass Tide",
    subtitle: "A Novel",
    totals: { acts: 1, chapters: 1, scenes: 2, words: 1, summaries: 1 },
    acts: [
      {
        title: "Act One",
        wordCount: 1,
        chapters: [
          {
            title: "Arrival",
            wordCount: 1,
            scenes: [
              { title: "Harbor", wordCount: 1, hasSummary: true },
              { title: "Inn", wordCount: 0, hasSummary: false },
            ],
          },
        ],
      },
    ],
    warnings: [],
    ...overrides,
  };
}

type Reply = { status: number; body: unknown };

function stubFetch(...replies: (Reply | Error)[]) {
  const calls: { url: string; form: FormData }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, form: init.body as FormData });
    const r = replies.shift() ?? { status: 200, body: {} };
    if (r instanceof Error) throw r;
    return {
      ok: r.status < 300,
      status: r.status,
      text: async () => JSON.stringify(r.body),
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

function setup(onImported = vi.fn()) {
  const onClose = vi.fn();
  render(
    React.createElement(ImportManuscriptDialog, {
      novelId: "novel-1",
      novelTitle: "Untitled",
      onClose,
      onImported,
    }),
  );
  return { onClose, onImported };
}

function chooseFile(name = "book.md") {
  const input = screen.getByLabelText("Manuscript file") as HTMLInputElement;
  expect(input.accept).toBe(IMPORT_ACCEPT);
  fireEvent.change(input, { target: { files: [new File(["# Book"], name)] } });
}

const formFields = (form: FormData) =>
  Object.fromEntries(
    [...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<file>"]),
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ImportManuscriptDialog (STO-1213)", () => {
  it("previews without confirming, then imports with the detected title applied", async () => {
    const calls = stubFetch(
      { status: 200, body: { preview: makePreview() } },
      { status: 201, body: { preview: makePreview(), actIds: ["a1"], titleApplied: true } },
    );
    const { onClose, onImported } = setup();

    const previewButton = screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement;
    expect(previewButton.disabled).toBe(true);
    chooseFile();
    fireEvent.click(screen.getByTestId("import-summaries"));
    fireEvent.click(previewButton);

    await screen.findByTestId("import-preview");
    expect(calls[0].url).toBe("/api/books/novel-1/import");
    expect(formFields(calls[0].form)).toEqual({ file: "<file>", summaries: "false" });
    expect(screen.getByTestId("import-totals").textContent).toBe(
      "1 act, 1 chapter, 2 scenes · 1 word",
    );
    expect(screen.getByText("Act One")).toBeTruthy();
    expect(screen.getByText("Arrival")).toBeTruthy();
    expect(screen.queryByTestId("import-warnings")).toBeNull();

    const apply = screen.getByTestId("import-apply-title") as HTMLInputElement;
    expect(apply.checked).toBe(false);
    expect(apply.closest("label")?.textContent).toContain("The Glass Tide");
    expect(apply.closest("label")?.textContent).toContain("A Novel");
    expect(apply.closest("label")?.textContent).toContain("Untitled");
    fireEvent.click(apply);

    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(formFields(calls[1].form)).toEqual({
      file: "<file>",
      summaries: "false",
      confirm: "true",
      applyTitle: "true",
    });
    expect(onImported).toHaveBeenCalledWith(
      expect.objectContaining({ actIds: ["a1"], titleApplied: true }),
    );
  });

  it("shows warnings, hides the title option when none was detected and blocks empty imports", async () => {
    stubFetch({
      status: 200,
      body: {
        preview: makePreview({
          title: null,
          subtitle: null,
          totals: { acts: 0, chapters: 0, scenes: 0, words: 0, summaries: 0 },
          acts: [],
          warnings: ["No content was found to import."],
        }),
      },
    });
    setup();
    chooseFile();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect((await screen.findByTestId("import-warnings")).textContent).toContain(
      "No content was found",
    );
    expect(screen.queryByTestId("import-apply-title")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Confirm import" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Manuscript file")).toBeTruthy();
  });

  it("offers a subtitle-only title option", async () => {
    stubFetch({ status: 200, body: { preview: makePreview({ title: null }) } });
    setup();
    chooseFile();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const apply = await screen.findByTestId("import-apply-title");
    const text = apply.closest("label")?.textContent ?? "";
    expect(text).toContain("A Novel");
    expect(text).not.toContain("The Glass Tide");
  });

  it("reports preview and import errors and keeps the dialog open", async () => {
    stubFetch(
      { status: 415, body: { error: "Unsupported format. Use .docx, .md or .html" } },
      new Error("offline"),
      { status: 200, body: { preview: makePreview() } },
      { status: 400, body: { error: "No content was found to import" } },
    );
    const { onClose, onImported } = setup();
    chooseFile("book.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Unsupported format");

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Network error: offline"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByTestId("import-preview");
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("No content was found"),
    );
    expect(onImported).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after a committed import even if the refresh fails", async () => {
    stubFetch(
      { status: 200, body: { preview: makePreview() } },
      { status: 201, body: { preview: makePreview(), actIds: ["a1"], titleApplied: false } },
    );
    const { onClose } = setup(vi.fn().mockRejectedValue(new Error("refresh failed")));
    chooseFile();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByTestId("import-preview");
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("cancels from the file step", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
