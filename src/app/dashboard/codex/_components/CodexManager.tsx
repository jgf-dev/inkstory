"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CodexCreateModal } from "./CodexCreateModal";
import { CodexEditor } from "./CodexEditor";
import type { CodexType } from "@/lib/codex/types";

interface CodexManagerProps {
  initialEntries: any[];
  novels: Array<{ id: string; title: string; seriesId: string | null }>;
  series: Array<{ id: string; title: string }>;
}

const TYPE_PILLS: Array<{ label: string; value: CodexType | "ALL" }> = [
  { label: "All", value: "ALL" },
  { label: "Characters", value: "CHARACTER" },
  { label: "Locations", value: "LOCATION" },
  { label: "Items", value: "ITEM" },
  { label: "Lore", value: "LORE" },
  { label: "Factions", value: "FACTION" },
  { label: "Concepts", value: "CONCEPT" },
];

export function CodexManager({ initialEntries, novels, series }: CodexManagerProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(
    initialEntries[0]?.id || null,
  );
  const [activeType, setActiveType] = useState<CodexType | "ALL">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (activeType !== "ALL" && entry.type !== activeType) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = entry.name.toLowerCase().includes(q);
        const matchesDesc = (entry.description || "").toLowerCase().includes(q);
        if (!matchesName && !matchesDesc) return false;
      }
      return true;
    });
  }, [entries, activeType, searchQuery]);

  function handleEntryCreated(newEntry: any) {
    setEntries((prev) => [newEntry, ...prev]);
    setSelectedEntryId(newEntry.id);
  }

  function handleEntryUpdated(updatedEntry: any) {
    setEntries((prev) =>
      prev.map((e) => (e.id === updatedEntry.id ? { ...e, ...updatedEntry } : e)),
    );
  }

  function handleEntryDeleted(deletedId: string) {
    setEntries((prev) => prev.filter((e) => e.id !== deletedId));
    setSelectedEntryId((prev) => (prev === deletedId ? null : prev));
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Top Header */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-ink-200 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-ink-500">
            <Link href="/dashboard" className="hover:underline">
              Dashboard
            </Link>
            <span>/</span>
            <span className="text-ink-800 font-medium">Codex</span>
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink-900">Story Codex</h1>
          <p className="mt-0.5 text-xs text-ink-500">
            AI-aware story bible: characters, world elements, relations, and narrative progressions.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="rounded-lg bg-ink-800 px-4 py-2 text-sm font-medium text-ink-50 shadow-xs hover:bg-ink-900"
        >
          + New Codex Entry
        </button>
      </header>

      {/* Main Layout: Left Sidebar + Right Editor */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Filter & List */}
        <div className="space-y-4 lg:col-span-4">
          {/* Search bar */}
          <div>
            <input
              type="text"
              placeholder="Search entries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-ink-400 focus:outline-hidden"
            />
          </div>

          {/* Type Filter Pills */}
          <div className="flex flex-wrap gap-1">
            {TYPE_PILLS.map((pill) => (
              <button
                key={pill.value}
                type="button"
                onClick={() => setActiveType(pill.value)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  activeType === pill.value
                    ? "bg-ink-800 text-ink-50"
                    : "bg-ink-100 text-ink-600 hover:bg-ink-200"
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {/* Entries list */}
          <div className="max-h-[600px] space-y-2 overflow-y-auto rounded-lg border border-ink-200 bg-ink-50 p-2">
            {filteredEntries.map((entry) => {
              const isSelected = entry.id === selectedEntryId;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelectedEntryId(entry.id)}
                  className={`w-full rounded-md p-3 text-left transition-colors ${
                    isSelected ? "border-ink-300 bg-ink-200/70 border" : "hover:bg-ink-100/70"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: entry.color || "#3b82f6" }}
                      />
                      <span className="text-sm font-medium text-ink-900">{entry.name}</span>
                    </div>
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-600">
                      {entry.type}
                    </span>
                  </div>

                  {entry.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-ink-500">{entry.description}</p>
                  )}

                  <div className="mt-2 flex items-center gap-2 text-[10px] text-ink-400">
                    <span>{entry.seriesScoped ? "Series" : "Book"}</span>
                    <span>•</span>
                    <span>{entry.trackingMode}</span>
                  </div>
                </button>
              );
            })}

            {filteredEntries.length === 0 && (
              <div className="p-6 text-center text-xs text-ink-400">
                No entries match the filter criteria.
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Editor */}
        <div className="rounded-xl border border-ink-200 bg-ink-50 p-6 lg:col-span-8">
          {selectedEntryId ? (
            <CodexEditor
              key={selectedEntryId}
              entryId={selectedEntryId}
              onEntryUpdated={handleEntryUpdated}
              onEntryDeleted={handleEntryDeleted}
            />
          ) : (
            <div className="flex h-64 flex-col items-center justify-center text-center text-sm text-ink-500">
              <p className="font-medium text-ink-700">No Codex Entry Selected</p>
              <p className="mt-1 text-xs text-ink-400">
                Select an entry from the list or create a new one to start editing.
              </p>
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="mt-4 rounded-md bg-ink-800 px-3 py-1.5 text-xs font-medium text-ink-50 hover:bg-ink-900"
              >
                + New Codex Entry
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Creation Modal */}
      <CodexCreateModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        novels={novels}
        series={series}
        onCreated={handleEntryCreated}
      />
    </div>
  );
}
