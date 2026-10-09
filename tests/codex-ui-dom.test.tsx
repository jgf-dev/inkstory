// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const actions = vi.hoisted(() => ({
  getCodexEntryAction: vi.fn(),
  updateCodexEntryAction: vi.fn(),
  deleteCodexEntryAction: vi.fn(),
  createCodexAliasAction: vi.fn(),
  deleteCodexAliasAction: vi.fn(),
  createCodexTagAction: vi.fn(),
  deleteCodexTagAction: vi.fn(),
  createCodexRelationAction: vi.fn(),
  updateCodexRelationAction: vi.fn(),
  deleteCodexRelationAction: vi.fn(),
  createCodexProgressionAction: vi.fn(),
  updateCodexProgressionAction: vi.fn(),
  deleteCodexProgressionAction: vi.fn(),
  createCodexEntryAction: vi.fn(),
}));
vi.mock("../src/lib/codex/actions", () => actions);
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) =>
    React.createElement("a", { href, ...rest }, children),
}));

import { CodexEditor } from "../src/app/dashboard/codex/_components/CodexEditor";
import { CodexManager } from "../src/app/dashboard/codex/_components/CodexManager";
import { Modal } from "../src/app/dashboard/codex/_components/Modal";
import { RelationEditorModal } from "../src/app/dashboard/codex/_components/RelationEditorModal";
import { ProgressionEditorModal } from "../src/app/dashboard/codex/_components/ProgressionEditorModal";

const novels = [
  { id: "novel-1", title: "Storm Tide", seriesId: "series-1" },
  { id: "novel-2", title: "Low Water", seriesId: "series-1" },
];

function makeEntry(overrides: Record<string, any> = {}) {
  return {
    id: "entry-1",
    name: "Mara",
    type: "CHARACTER",
    trackingMode: "DETECTED",
    description: "A harbour pilot",
    notes: "secret",
    color: "#ff0000",
    seriesScoped: false,
    seriesId: null,
    novelId: "novel-1",
    customFields: { age: 32, role: "pilot" },
    aliases: [{ id: "alias-1", name: "The Pilot" }],
    tags: [{ id: "tag-1", name: "lead" }],
    sourceRelations: [
      {
        id: "rel-1",
        relationType: "ALLY",
        reverseType: null,
        description: "Old friends",
        targetEntryId: "entry-2",
        targetEntry: { name: "Jonah" },
      },
    ],
    targetRelations: [
      {
        id: "rel-2",
        relationType: "MENTOR",
        reverseType: "MENTORED_BY",
        description: null,
        sourceEntryId: "entry-3",
        sourceEntry: null,
      },
    ],
    progressions: [
      {
        id: "prog-1",
        sceneId: "scene-1",
        mode: "ADDITION",
        description: "Loses her ship",
        notes: null,
      },
    ],
    ...overrides,
  };
}

const outlinePayload = {
  outline: {
    acts: [
      {
        title: "Act I",
        chapters: [{ title: "Ch 1", scenes: [{ id: "scene-1", title: "The Quay" }] }],
      },
    ],
  },
};

const entriesList = [
  { id: "entry-1", name: "Mara", type: "CHARACTER" },
  { id: "entry-2", name: "Jonah", type: "CHARACTER" },
];

let confirmMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  confirmMock = vi.fn().mockReturnValue(true);
  vi.stubGlobal("confirm", confirmMock);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => outlinePayload }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderEditor(entry = makeEntry(), extra: Record<string, any> = {}) {
  actions.getCodexEntryAction.mockResolvedValue({ success: true, data: entry });
  const props = {
    entryId: entry.id,
    entries: entriesList,
    novels,
    onEntryUpdated: vi.fn(),
    onEntryDeleted: vi.fn(),
    ...extra,
  };
  const utils = render(React.createElement(CodexEditor, props));
  await screen.findByTestId("codex-editor");
  await waitFor(() =>
    expect(screen.getByText(/At: Storm Tide · Act I → Ch 1 → The Quay/)).toBeTruthy(),
  );
  return { props, ...utils };
}

describe("Modal", () => {
  it("closes on Escape and the close button only", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      React.createElement(Modal, { title: "T", onClose, testId: "m", children: "body" }),
    );
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("CodexEditor", () => {
  it("loads the entry, shows sub-entities and resolves scene labels", async () => {
    await renderEditor();
    expect(screen.getByDisplayValue("Mara")).toBeTruthy();
    expect(screen.getByDisplayValue("32")).toBeTruthy();
    expect(screen.getByDisplayValue("pilot")).toBeTruthy();
    expect(screen.getByText("The Pilot")).toBeTruthy();
    expect(screen.getByText("lead")).toBeTruthy();
    expect(screen.getByText("MENTORED_BY")).toBeTruthy();
    expect(screen.getByText(/← entry-3/)).toBeTruthy();
    expect(screen.getByText("Book-Scoped")).toBeTruthy();
  });

  it("shows load errors and missing entries", async () => {
    actions.getCodexEntryAction.mockResolvedValue({ success: false });
    render(
      React.createElement(CodexEditor, {
        entryId: "x",
        onEntryUpdated: vi.fn(),
        onEntryDeleted: vi.fn(),
      }),
    );
    expect(await screen.findByText("Failed to load entry")).toBeTruthy();
    cleanup();
    actions.getCodexEntryAction.mockRejectedValue(new Error("network"));
    render(
      React.createElement(CodexEditor, {
        entryId: "x",
        onEntryUpdated: vi.fn(),
        onEntryDeleted: vi.fn(),
      }),
    );
    expect(await screen.findByText("network")).toBeTruthy();
  });

  it("saves edited fields and custom fields", async () => {
    const { props } = await renderEditor();
    fireEvent.change(screen.getByDisplayValue("Mara"), { target: { value: " Mara Vell " } });
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "LOCATION" } });
    fireEvent.change(selects[1], { target: { value: "ALWAYS" } });
    fireEvent.change(screen.getByDisplayValue("A harbour pilot"), { target: { value: "Pilot" } });
    fireEvent.change(screen.getByDisplayValue("secret"), { target: { value: "  " } });
    fireEvent.click(screen.getByText("+ Add Field"));
    fireEvent.change(screen.getByLabelText("Custom field 3 name"), { target: { value: " ship " } });
    fireEvent.change(screen.getByLabelText("Custom field 3 value"), { target: { value: "Gull" } });
    fireEvent.click(screen.getByText("+ Add Field"));
    fireEvent.change(screen.getByLabelText("Custom field 4 name"), { target: { value: "blank" } });
    fireEvent.click(screen.getByText("+ Add Field")); // fully empty row is dropped
    fireEvent.click(screen.getByLabelText("Remove custom field 2"));

    const saved = makeEntry({ name: "Mara Vell" });
    actions.updateCodexEntryAction.mockResolvedValue({ success: true, data: saved });
    fireEvent.click(screen.getByText("Save Changes"));
    expect(await screen.findByText("Changes saved successfully.")).toBeTruthy();
    expect(actions.updateCodexEntryAction).toHaveBeenCalledWith("entry-1", {
      name: "Mara Vell",
      type: "LOCATION",
      trackingMode: "ALWAYS",
      description: "Pilot",
      notes: null,
      color: "#ff0000",
      customFields: { age: 32, ship: "Gull", blank: "" },
    });
    expect(props.onEntryUpdated).toHaveBeenCalledWith(saved);
  });

  it("validates custom field names before saving", async () => {
    await renderEditor(makeEntry({ customFields: {} }));
    expect(screen.getByText("No custom fields yet.")).toBeTruthy();
    fireEvent.click(screen.getByText("+ Add Field"));
    fireEvent.change(screen.getByLabelText("Custom field 1 value"), { target: { value: "v" } });
    fireEvent.click(screen.getByText("Save Changes"));
    expect(await screen.findByText(/needs a name/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Custom field 1 name"), { target: { value: "a" } });
    fireEvent.click(screen.getByText("+ Add Field"));
    fireEvent.change(screen.getByLabelText("Custom field 2 name"), { target: { value: "a" } });
    fireEvent.click(screen.getByText("Save Changes"));
    expect(await screen.findByText('Duplicate custom field name: "a".')).toBeTruthy();
    expect(actions.updateCodexEntryAction).not.toHaveBeenCalled();
  });

  it("surfaces save failures", async () => {
    await renderEditor();
    actions.updateCodexEntryAction.mockResolvedValue({ success: false });
    fireEvent.click(screen.getByText("Save Changes"));
    expect(await screen.findByText("Failed to update entry.")).toBeTruthy();
    actions.updateCodexEntryAction.mockRejectedValue(new Error("db down"));
    fireEvent.click(screen.getByText("Save Changes"));
    expect(await screen.findByText("db down")).toBeTruthy();
    actions.updateCodexEntryAction.mockRejectedValue("weird");
    fireEvent.click(screen.getByText("Save Changes"));
    expect(await screen.findByText("Error saving changes.")).toBeTruthy();
  });

  it("deletes the entry after confirmation and reports failures", async () => {
    const { props } = await renderEditor();
    confirmMock.mockReturnValueOnce(false);
    fireEvent.click(screen.getByText("Delete"));
    expect(actions.deleteCodexEntryAction).not.toHaveBeenCalled();

    actions.deleteCodexEntryAction.mockResolvedValueOnce({ success: false, error: "nope" });
    fireEvent.click(screen.getByText("Delete"));
    expect(await screen.findByText("nope")).toBeTruthy();

    actions.deleteCodexEntryAction.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(screen.getByText("Delete"));
    expect(await screen.findByText("boom")).toBeTruthy();

    actions.deleteCodexEntryAction.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(props.onEntryDeleted).toHaveBeenCalledWith("entry-1"));
  });

  it("adds and removes aliases and tags", async () => {
    await renderEditor();
    const aliasInput = screen.getByPlaceholderText("New alias name...");
    fireEvent.submit(aliasInput.closest("form")!);
    expect(actions.createCodexAliasAction).not.toHaveBeenCalled();
    fireEvent.change(aliasInput, { target: { value: "Vell" } });
    actions.createCodexAliasAction.mockResolvedValueOnce({ success: false });
    fireEvent.submit(aliasInput.closest("form")!);
    expect(await screen.findByText("Failed to add alias")).toBeTruthy();
    actions.createCodexAliasAction.mockResolvedValueOnce({
      success: true,
      data: { id: "alias-2", name: "Vell" },
    });
    fireEvent.submit(aliasInput.closest("form")!);
    expect(await screen.findByText("Vell")).toBeTruthy();

    const tagInput = screen.getByPlaceholderText("New tag...");
    fireEvent.submit(tagInput.closest("form")!);
    fireEvent.change(tagInput, { target: { value: "pov" } });
    actions.createCodexTagAction.mockResolvedValueOnce({ success: false });
    fireEvent.submit(tagInput.closest("form")!);
    expect(await screen.findByText("Failed to add tag")).toBeTruthy();
    actions.createCodexTagAction.mockResolvedValueOnce({
      success: true,
      data: { id: "tag-2", name: "pov" },
    });
    fireEvent.submit(tagInput.closest("form")!);
    expect(await screen.findByText("pov")).toBeTruthy();

    actions.deleteCodexAliasAction.mockResolvedValue({ success: true });
    actions.deleteCodexTagAction.mockResolvedValue({ success: true });
    const removeButtons = () =>
      screen
        .getAllByText("×")
        .filter((b) => b.closest("span")?.textContent?.match(/The Pilot|lead/));
    for (const b of removeButtons()) fireEvent.click(b);
    await waitFor(() => expect(screen.queryByText("The Pilot")).toBeNull());
    await waitFor(() => expect(screen.queryByText("lead")).toBeNull());

    actions.deleteCodexAliasAction.mockRejectedValueOnce(new Error("alias err"));
    fireEvent.click(screen.getByText("Vell").querySelector("button")!);
    expect(await screen.findByText("alias err")).toBeTruthy();
    actions.deleteCodexTagAction.mockRejectedValueOnce("x");
    fireEvent.click(screen.getByText("pov").querySelector("button")!);
    expect(await screen.findByText("Failed to delete tag")).toBeTruthy();
  });

  it("deletes relations and progressions inline", async () => {
    await renderEditor();
    confirmMock.mockReturnValueOnce(false);
    fireEvent.click(screen.getByLabelText("Delete relation to Jonah"));
    expect(actions.deleteCodexRelationAction).not.toHaveBeenCalled();

    actions.deleteCodexRelationAction.mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByLabelText("Delete relation to Jonah"));
    expect(await screen.findByText("Failed to delete relation")).toBeTruthy();
    actions.deleteCodexRelationAction.mockRejectedValueOnce(new Error("rel boom"));
    fireEvent.click(screen.getByLabelText("Delete relation from entry-3"));
    expect(await screen.findByText("rel boom")).toBeTruthy();

    actions.deleteCodexRelationAction.mockResolvedValueOnce({ success: true });
    actions.getCodexEntryAction.mockResolvedValueOnce({
      success: true,
      data: makeEntry({ sourceRelations: [], targetRelations: [] }),
    });
    fireEvent.click(screen.getByLabelText("Delete relation to Jonah"));
    expect(await screen.findByText("No relations established yet.")).toBeTruthy();

    confirmMock.mockReturnValueOnce(false);
    fireEvent.click(screen.getByLabelText("Delete progression"));
    actions.deleteCodexProgressionAction.mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByLabelText("Delete progression"));
    expect(await screen.findByText("Failed to delete progression")).toBeTruthy();
    actions.deleteCodexProgressionAction.mockRejectedValueOnce("x");
    fireEvent.click(screen.getByLabelText("Delete progression"));
    actions.deleteCodexProgressionAction.mockResolvedValueOnce({ success: true });
    actions.getCodexEntryAction.mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByLabelText("Delete progression"));
    expect(await screen.findByText("Failed to refresh entry")).toBeTruthy();
  });

  it("opens relation and progression editors in create and edit mode", async () => {
    await renderEditor();
    fireEvent.click(screen.getByText("+ Add Relation"));
    expect(screen.getByTestId("relation-editor-modal")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("relation-editor-modal")).toBeNull();

    fireEvent.click(screen.getByLabelText("Edit relation to Jonah"));
    expect(screen.getByText("Edit Relation")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByLabelText("Edit relation from entry-3"));
    expect(screen.getByDisplayValue("MENTORED_BY")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));

    fireEvent.click(screen.getByText("+ Add Progression"));
    expect(screen.getByTestId("progression-editor-modal")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByLabelText("Edit progression"));
    expect(screen.getByText("Edit Progression")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
  });

  it("loads series-scoped scene options and tolerates outline failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => outlinePayload })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await renderEditor(makeEntry({ seriesScoped: true, seriesId: "series-1", novelId: null }));
    expect(fetchMock).toHaveBeenCalledWith("/api/novels/novel-2/outline");
    expect(screen.getByText("Series-Scoped")).toBeTruthy();
  });

  it("skips scene loading for entries without scope", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("x"));
    vi.stubGlobal("fetch", fetchMock);
    actions.getCodexEntryAction.mockResolvedValue({
      success: true,
      data: makeEntry({
        novelId: null,
        progressions: [],
        aliases: [],
        tags: [],
        customFields: undefined,
        color: null,
        description: null,
        notes: null,
      }),
    });
    render(
      React.createElement(CodexEditor, {
        entryId: "entry-1",
        onEntryUpdated: vi.fn(),
        onEntryDeleted: vi.fn(),
      }),
    );
    expect(await screen.findByText("No progressions recorded yet.")).toBeTruthy();
    expect(screen.getByText("No aliases added yet.")).toBeTruthy();
    expect(screen.getByText("No tags added yet.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders immediately from an initial entry", async () => {
    const entry = makeEntry();
    actions.getCodexEntryAction.mockResolvedValue({ success: true, data: entry });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(
      React.createElement(CodexEditor, {
        entryId: "entry-1",
        initialEntry: entry,
        onEntryUpdated: vi.fn(),
        onEntryDeleted: vi.fn(),
      }),
    );
    expect(screen.getByTestId("codex-editor")).toBeTruthy();
    await waitFor(() => expect(actions.getCodexEntryAction).toHaveBeenCalled());
    expect(await screen.findByText("At: scene-1")).toBeTruthy();
  });
});

describe("RelationEditorModal", () => {
  function setup(relation: any = null, entries = entriesList) {
    const props = {
      isOpen: true,
      entryId: "entry-1",
      entryName: "Mara",
      entries,
      relation,
      onClose: vi.fn(),
      onSaved: vi.fn(),
    };
    render(React.createElement(RelationEditorModal, props));
    return props;
  }

  it("renders nothing when closed", () => {
    const { container } = render(
      React.createElement(RelationEditorModal, {
        isOpen: false,
        entryId: "e",
        entryName: "n",
        entries: [],
        relation: null,
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );
    expect(container.innerHTML).toBe("");
  });

  it("validates and creates a relation", async () => {
    const p = setup();
    const form = screen.getByTestId("relation-editor-modal").querySelector("form")!;
    fireEvent.submit(form);
    expect(await screen.findByText("Please provide a relation type.")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("e.g. ALLY, MENTOR, LOCATED_IN"), {
      target: { value: " ALLY " },
    });
    fireEvent.submit(form);
    expect(await screen.findByText("Please choose the related entry.")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("Choose an entry…"), {
      target: { value: "entry-2" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. MENTOR → MENTORED_BY"), {
      target: { value: "ALLY" },
    });
    fireEvent.change(screen.getByPlaceholderText("How are they connected?"), {
      target: { value: "  " },
    });
    actions.createCodexRelationAction.mockResolvedValueOnce({ success: false });
    fireEvent.submit(form);
    expect(await screen.findByText("Failed to save relation.")).toBeTruthy();
    actions.createCodexRelationAction.mockRejectedValueOnce(new Error("x1"));
    fireEvent.submit(form);
    expect(await screen.findByText("x1")).toBeTruthy();
    actions.createCodexRelationAction.mockResolvedValueOnce({ success: true });
    fireEvent.submit(form);
    await waitFor(() => expect(p.onClose).toHaveBeenCalled());
    expect(p.onSaved).toHaveBeenCalled();
    expect(actions.createCodexRelationAction).toHaveBeenLastCalledWith({
      sourceEntryId: "entry-1",
      targetEntryId: "entry-2",
      relationType: "ALLY",
      reverseType: "ALLY",
      description: null,
    });
  });

  it("explains when no other entries exist", () => {
    setup(null, [entriesList[0]]);
    expect(screen.getByText(/No other entries yet/)).toBeTruthy();
  });

  it("updates and deletes an existing relation", async () => {
    const relation = {
      id: "rel-1",
      relationType: "ALLY",
      reverseType: null,
      description: null,
      direction: "target",
      otherName: "Jonah",
    };
    const p = setup(relation);
    const form = screen.getByTestId("relation-editor-modal").querySelector("form")!;
    actions.updateCodexRelationAction.mockResolvedValueOnce({ success: true });
    fireEvent.submit(form);
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledTimes(1));
    expect(actions.updateCodexRelationAction).toHaveBeenCalledWith("rel-1", {
      relationType: "ALLY",
      reverseType: null,
      description: null,
    });

    confirmMock.mockReturnValueOnce(false);
    fireEvent.click(screen.getByText("Delete Relation"));
    expect(actions.deleteCodexRelationAction).not.toHaveBeenCalled();
    actions.deleteCodexRelationAction.mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByText("Delete Relation"));
    expect(await screen.findByText("Failed to delete relation.")).toBeTruthy();
    actions.deleteCodexRelationAction.mockRejectedValueOnce("x");
    fireEvent.click(screen.getByText("Delete Relation"));
    expect(await screen.findByText("An unexpected error occurred.")).toBeTruthy();
    actions.deleteCodexRelationAction.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByText("Delete Relation"));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledTimes(2));
  });
});

describe("ProgressionEditorModal", () => {
  const sceneOptions = [{ id: "scene-1", label: "Act I → The Quay" }];
  function setup(progression: any = null, options = sceneOptions) {
    const props = {
      isOpen: true,
      entryId: "entry-1",
      progression,
      sceneOptions: options,
      onClose: vi.fn(),
      onSaved: vi.fn(),
    };
    render(React.createElement(ProgressionEditorModal, props));
    return props;
  }

  it("renders nothing when closed", () => {
    const { container } = render(
      React.createElement(ProgressionEditorModal, {
        isOpen: false,
        entryId: "e",
        progression: null,
        sceneOptions: [],
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );
    expect(container.innerHTML).toBe("");
  });

  it("validates and creates a progression", async () => {
    const p = setup();
    const form = screen.getByTestId("progression-editor-modal").querySelector("form")!;
    fireEvent.submit(form);
    expect(await screen.findByText(/Please choose the scene/)).toBeTruthy();
    const [sceneSelect, modeSelect] = screen.getAllByRole("combobox");
    fireEvent.change(sceneSelect, { target: { value: "scene-1" } });
    fireEvent.submit(form);
    expect(await screen.findByText("Please describe the evolved state.")).toBeTruthy();
    fireEvent.change(modeSelect, { target: { value: "REPLACEMENT" } });
    fireEvent.change(screen.getByPlaceholderText(/What is true about this entry/), {
      target: { value: " Captain now " },
    });
    fireEvent.change(screen.getByPlaceholderText(/Author reminders/), { target: { value: "n" } });
    actions.createCodexProgressionAction.mockResolvedValueOnce({ success: false });
    fireEvent.submit(form);
    expect(await screen.findByText("Failed to save progression.")).toBeTruthy();
    actions.createCodexProgressionAction.mockRejectedValueOnce(new Error("p1"));
    fireEvent.submit(form);
    expect(await screen.findByText("p1")).toBeTruthy();
    actions.createCodexProgressionAction.mockResolvedValueOnce({ success: true });
    fireEvent.submit(form);
    await waitFor(() => expect(p.onClose).toHaveBeenCalled());
    expect(actions.createCodexProgressionAction).toHaveBeenLastCalledWith({
      entryId: "entry-1",
      sceneId: "scene-1",
      mode: "REPLACEMENT",
      description: "Captain now",
      notes: "n",
    });
  });

  it("explains when there are no scenes", () => {
    setup(null, []);
    expect(screen.getByText(/No scenes found/)).toBeTruthy();
  });

  it("updates and deletes an existing progression", async () => {
    const progression = {
      id: "prog-1",
      sceneId: "scene-9",
      mode: "ADDITION",
      description: "Old",
      notes: null,
    };
    const p = setup(progression);
    expect(screen.getByText("scene-9")).toBeTruthy();
    const form = screen.getByTestId("progression-editor-modal").querySelector("form")!;
    actions.updateCodexProgressionAction.mockResolvedValueOnce({ success: true });
    fireEvent.submit(form);
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledTimes(1));
    expect(actions.updateCodexProgressionAction).toHaveBeenCalledWith("prog-1", {
      mode: "ADDITION",
      description: "Old",
      notes: null,
    });

    confirmMock.mockReturnValueOnce(false);
    fireEvent.click(screen.getByText("Delete Progression"));
    actions.deleteCodexProgressionAction.mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByText("Delete Progression"));
    expect(await screen.findByText("Failed to delete progression.")).toBeTruthy();
    actions.deleteCodexProgressionAction.mockRejectedValueOnce(new Error("d1"));
    fireEvent.click(screen.getByText("Delete Progression"));
    expect(await screen.findByText("d1")).toBeTruthy();
    actions.deleteCodexProgressionAction.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByText("Delete Progression"));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledTimes(2));
  });
});

describe("CodexManager", () => {
  const initialEntries = [
    makeEntry(),
    {
      id: "entry-2",
      name: "Saltmarsh",
      type: "LOCATION",
      description: null,
      color: null,
      seriesScoped: true,
      trackingMode: "ALWAYS",
    },
  ];

  it("filters, selects, and reacts to editor updates and deletions", async () => {
    actions.getCodexEntryAction.mockImplementation(async (id: string) => ({
      success: true,
      data: id === "entry-1" ? makeEntry() : makeEntry({ id: "entry-2", name: "Saltmarsh" }),
    }));
    render(React.createElement(CodexManager, { initialEntries, novels, series: [] }));
    await screen.findByTestId("codex-editor");

    fireEvent.click(screen.getByText("Locations"));
    expect(screen.queryByRole("button", { name: /^Mara/ })).toBeNull();
    fireEvent.click(screen.getByText("All"));
    fireEvent.change(screen.getByPlaceholderText("Search entries..."), {
      target: { value: "harbour" },
    });
    expect(screen.queryByText("Saltmarsh")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search entries..."), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No entries match the filter criteria.")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search entries..."), { target: { value: "" } });

    fireEvent.click(screen.getByText("Saltmarsh"));
    await waitFor(() => expect(actions.getCodexEntryAction).toHaveBeenCalledWith("entry-2"));
    await screen.findByTestId("codex-editor");

    actions.updateCodexEntryAction.mockResolvedValue({
      success: true,
      data: makeEntry({ id: "entry-2", name: "Saltmarsh Flats" }),
    });
    fireEvent.click(screen.getByText("Save Changes"));
    await waitFor(() => expect(screen.getAllByText("Saltmarsh Flats").length).toBeGreaterThan(0));

    actions.deleteCodexEntryAction.mockResolvedValue({ success: true });
    fireEvent.click(screen.getByText("Delete"));
    expect(await screen.findByText("No Codex Entry Selected")).toBeTruthy();

    fireEvent.click(screen.getAllByText("+ New Codex Entry")[1]);
    await act(async () => {});
  });
});
