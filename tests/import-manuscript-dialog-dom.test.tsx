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

describe("ImportManuscriptDialog structure override (STO-1211)", () => {
  const regrouped = makePreview({
    totals: { acts: 2, chapters: 2, scenes: 2, words: 1, summaries: 1 },
    acts: [
      {
        title: "Part One",
        wordCount: 1,
        chapters: [
          {
            title: "Arrival",
            wordCount: 1,
            scenes: [{ title: "Dock", wordCount: 1, hasSummary: true }],
          },
        ],
      },
      {
        title: "Act 2",
        wordCount: 0,
        chapters: [
          {
            title: "Chapter 2",
            wordCount: 0,
            scenes: [{ title: "Inn", wordCount: 0, hasSummary: false }],
          },
        ],
      },
    ],
  });

  async function openEditor() {
    chooseFile();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByTestId("import-preview");
    fireEvent.click(screen.getByRole("button", { name: "Adjust structure" }));
    return screen.getByTestId("import-structure-editor");
  }

  const box = (name: string, index: number) =>
    screen.getAllByRole("checkbox", { name })[index] as HTMLInputElement;
  const text = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

  it("edits, applies and confirms an override", async () => {
    const calls = stubFetch(
      { status: 200, body: { preview: makePreview() } },
      { status: 200, body: { preview: regrouped } },
      { status: 201, body: { preview: regrouped, actIds: ["a1", "a2"], titleApplied: false } },
    );
    const { onClose } = setup();
    await openEditor();

    // The first scene always starts an act and a chapter.
    expect(box("New act", 0).checked).toBe(true);
    expect(box("New act", 0).disabled).toBe(true);
    expect(box("New chapter", 1).checked).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Confirm import" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(text("Act title at scene 1"), { target: { value: "Part One" } });
    fireEvent.change(text("Scene 1 title"), { target: { value: "Dock" } });
    // Starting an act also starts a chapter.
    fireEvent.click(box("New act", 1));
    expect(box("New chapter", 1).checked).toBe(true);
    expect(text("Act title at scene 2").value).toBe("Act 2");
    expect(text("Chapter title at scene 2").value).toBe("Chapter 2");

    fireEvent.click(screen.getByRole("button", { name: "Apply structure" }));
    await screen.findByText("Part One");
    expect(screen.queryByTestId("import-structure-editor")).toBeNull();
    expect(JSON.parse(formFields(calls[1].form).structure)).toEqual({
      scenes: [
        { title: "Dock", act: "Part One", chapter: "Arrival" },
        { title: "Inn", act: "Act 2", chapter: "Chapter 2" },
      ],
    });
    expect(formFields(calls[1].form).confirm).toBeUndefined();
    expect(screen.getByTestId("import-totals").textContent).toContain("2 acts");

    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(formFields(calls[2].form)).toMatchObject({
      confirm: "true",
      structure: formFields(calls[1].form).structure,
    });
  });

  it("blocks blank titles, unlinks an act from a dropped chapter and discards edits", async () => {
    stubFetch({ status: 200, body: { preview: makePreview() } });
    setup();
    await openEditor();

    fireEvent.change(text("Scene 2 title"), { target: { value: " " } });
    expect(screen.getByTestId("import-structure-blank")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Apply structure" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(text("Scene 2 title"), { target: { value: "Inn" } });
    expect(screen.queryByTestId("import-structure-blank")).toBeNull();

    fireEvent.click(box("New chapter", 1));
    expect(text("Chapter title at scene 2").value).toBe("Chapter 2");
    fireEvent.click(box("New act", 1));
    fireEvent.click(box("New act", 1));
    expect(screen.queryByLabelText("Act title at scene 2")).toBeNull();
    fireEvent.click(box("New act", 1));
    // Dropping the chapter start drops the act start with it.
    fireEvent.click(box("New chapter", 1));
    expect(box("New act", 1).checked).toBe(false);
    expect(screen.queryByLabelText("Chapter title at scene 2")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.queryByTestId("import-structure-editor")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Confirm import" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByRole("button", { name: "Use detected structure" })).toBeNull();
  });

  it("reports a rejected override and can return to the detected structure", async () => {
    const calls = stubFetch(
      { status: 200, body: { preview: makePreview() } },
      { status: 400, body: { error: "Preview the file again." } },
      { status: 200, body: { preview: regrouped } },
      { status: 201, body: { preview: makePreview(), actIds: ["a1"], titleApplied: false } },
    );
    const { onClose } = setup();
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Apply structure" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Preview the file again");
    expect(screen.getByTestId("import-structure-editor")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Apply structure" }));
    await screen.findByText("Part One");
    fireEvent.click(screen.getByRole("button", { name: "Use detected structure" }));
    expect(screen.getByText("Act One")).toBeTruthy();
    expect(screen.queryByText("Part One")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(formFields(calls[3].form).structure).toBeUndefined();
  });

  it("offers no override for an empty preview", async () => {
    stubFetch({
      status: 200,
      body: {
        preview: makePreview({
          totals: { acts: 0, chapters: 0, scenes: 0, words: 0, summaries: 0 },
          acts: [],
        }),
      },
    });
    setup();
    chooseFile();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByTestId("import-preview");
    expect(screen.queryByRole("button", { name: "Adjust structure" })).toBeNull();
  });
});
