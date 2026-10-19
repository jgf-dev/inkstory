"use client";

import React from "react";

// Alias Components
export interface CodexAliasItemProps {
  alias: { id: string; name: string };
  onDelete: (id: string) => void;
}

export function CodexAliasItem({ alias, onDelete }: CodexAliasItemProps) {
  return (
    <span className="flex items-center gap-1 rounded bg-ink-100 px-2 py-0.5 text-xs text-ink-800">
      {alias.name}
      <button
        type="button"
        onClick={() => onDelete(alias.id)}
        className="ml-1 text-ink-400 hover:text-ink-700"
      >
        ×
      </button>
    </span>
  );
}

export interface CodexAliasesSectionProps {
  aliases?: Array<{ id: string; name: string }>;
  onDeleteAlias: (id: string) => void;
  onAddAlias: (e: React.FormEvent) => void;
  newAliasName: string;
  setNewAliasName: (val: string) => void;
  addingAlias: boolean;
}

export function CodexAliasesSection({
  aliases,
  onDeleteAlias,
  onAddAlias,
  newAliasName,
  setNewAliasName,
  addingAlias,
}: CodexAliasesSectionProps) {
  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-600">
        Aliases (Mention Detection)
      </h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {aliases?.map((a) => (
          <CodexAliasItem key={a.id} alias={a} onDelete={onDeleteAlias} />
        ))}
        {(!aliases || aliases.length === 0) && (
          <p className="text-xs text-ink-400">No aliases added yet.</p>
        )}
      </div>

      <form onSubmit={onAddAlias} className="mt-3 flex gap-2">
        <input
          type="text"
          placeholder="New alias name..."
          value={newAliasName}
          onChange={(e) => setNewAliasName(e.target.value)}
          className="w-full rounded border border-ink-200 bg-ink-100 px-2 py-1 text-xs focus:border-ink-400 focus:outline-hidden"
        />
        <button
          type="submit"
          disabled={addingAlias || !newAliasName.trim()}
          className="rounded bg-ink-700 px-3 py-1 text-xs font-medium text-ink-50 hover:bg-ink-800 disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </div>
  );
}

// Tag Components
export interface CodexTagItemProps {
  tag: { id: string; name: string };
  onDelete: (id: string) => void;
}

export function CodexTagItem({ tag, onDelete }: CodexTagItemProps) {
  return (
    <span className="flex items-center gap-1 rounded bg-ink-100 px-2 py-0.5 text-xs text-ink-800">
      {tag.name}
      <button
        type="button"
        onClick={() => onDelete(tag.id)}
        className="ml-1 text-ink-400 hover:text-ink-700"
      >
        ×
      </button>
    </span>
  );
}

export interface CodexTagsSectionProps {
  tags?: Array<{ id: string; name: string }>;
  onDeleteTag: (id: string) => void;
  onAddTag: (e: React.FormEvent) => void;
  newTagName: string;
  setNewTagName: (val: string) => void;
  addingTag: boolean;
}

export function CodexTagsSection({
  tags,
  onDeleteTag,
  onAddTag,
  newTagName,
  setNewTagName,
  addingTag,
}: CodexTagsSectionProps) {
  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-600">Tags</h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {tags?.map((t) => (
          <CodexTagItem key={t.id} tag={t} onDelete={onDeleteTag} />
        ))}
        {(!tags || tags.length === 0) && <p className="text-xs text-ink-400">No tags added yet.</p>}
      </div>

      <form onSubmit={onAddTag} className="mt-3 flex gap-2">
        <input
          type="text"
          placeholder="New tag..."
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          className="w-full rounded border border-ink-200 bg-ink-100 px-2 py-1 text-xs focus:border-ink-400 focus:outline-hidden"
        />
        <button
          type="submit"
          disabled={addingTag || !newTagName.trim()}
          className="rounded bg-ink-700 px-3 py-1 text-xs font-medium text-ink-50 hover:bg-ink-800 disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </div>
  );
}

// Relation Components
export interface CodexSourceRelationCardProps {
  relation: {
    id: string;
    relationType: string;
    targetEntryId: string;
    targetEntry?: { id: string; name: string };
    description?: string | null;
  };
}

export function CodexSourceRelationCard({ relation }: CodexSourceRelationCardProps) {
  return (
    <div className="rounded border border-ink-200 bg-ink-100 p-2 text-xs text-ink-700">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-ink-900">{relation.relationType}</span>
        <span className="font-medium text-ink-600">
          → {relation.targetEntry?.name ?? relation.targetEntryId}
        </span>
      </div>
      {relation.description && <p className="mt-0.5 text-ink-500">{relation.description}</p>}
    </div>
  );
}

export interface CodexTargetRelationCardProps {
  relation: {
    id: string;
    relationType: string;
    reverseType?: string | null;
    sourceEntryId: string;
    sourceEntry?: { id: string; name: string };
    description?: string | null;
  };
}

export function CodexTargetRelationCard({ relation }: CodexTargetRelationCardProps) {
  return (
    <div className="rounded border border-ink-200 bg-ink-100 p-2 text-xs text-ink-700">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-ink-900">
          {relation.reverseType || relation.relationType}
        </span>
        <span className="font-medium text-ink-600">
          ← {relation.sourceEntry?.name ?? relation.sourceEntryId}
        </span>
      </div>
      {relation.description && <p className="mt-0.5 text-ink-500">{relation.description}</p>}
    </div>
  );
}

export interface CodexRelationsSectionProps {
  sourceRelations?: any[];
  targetRelations?: any[];
}

export function CodexRelationsSection({
  sourceRelations,
  targetRelations,
}: CodexRelationsSectionProps) {
  const hasNoRelations =
    (!sourceRelations || sourceRelations.length === 0) &&
    (!targetRelations || targetRelations.length === 0);

  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-600">
        Relations Graph
      </h3>
      <div className="mt-2 space-y-1.5">
        {sourceRelations?.map((r) => (
          <CodexSourceRelationCard key={r.id} relation={r} />
        ))}
        {targetRelations?.map((r) => (
          <CodexTargetRelationCard key={r.id} relation={r} />
        ))}
        {hasNoRelations && <p className="text-xs text-ink-400">No relations established yet.</p>}
      </div>
    </div>
  );
}

// Progression Components
export interface CodexProgressionCardProps {
  progression: {
    id: string;
    mode: string;
    description: string;
  };
}

export function CodexProgressionCard({ progression }: CodexProgressionCardProps) {
  return (
    <div className="rounded border border-ink-200 bg-ink-100 p-2 text-xs text-ink-700">
      <div className="flex items-center justify-between">
        <span className="font-semibold uppercase tracking-wide text-ink-600">
          {progression.mode}
        </span>
      </div>
      <p className="mt-0.5 text-ink-800">{progression.description}</p>
    </div>
  );
}

export interface CodexProgressionsSectionProps {
  progressions?: any[];
}

export function CodexProgressionsSection({ progressions }: CodexProgressionsSectionProps) {
  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-600">
        Temporal Progressions
      </h3>
      <div className="mt-2 space-y-1.5">
        {progressions?.map((p) => (
          <CodexProgressionCard key={p.id} progression={p} />
        ))}
        {(!progressions || progressions.length === 0) && (
          <p className="text-xs text-ink-400">No progressions recorded yet.</p>
        )}
      </div>
    </div>
  );
}
