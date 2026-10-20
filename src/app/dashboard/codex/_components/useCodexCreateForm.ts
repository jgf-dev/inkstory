import { useState } from "react";
import { createCodexEntryAction } from "@/lib/codex/actions";
import type { CodexTrackingMode, CodexType } from "@/lib/codex/types";

export interface UseCodexCreateFormProps {
  novels: Array<{ id: string; title: string; seriesId: string | null }>;
  series: Array<{ id: string; title: string }>;
  onCreated: (entry: any) => void;
  onClose: () => void;
}

export function useCodexCreateForm({
  novels,
  series,
  onCreated,
  onClose,
}: UseCodexCreateFormProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<CodexType>("CHARACTER");
  const [trackingMode, setTrackingMode] = useState<CodexTrackingMode>("DETECTED");
  const [seriesScoped, setSeriesScoped] = useState(false);
  const [selectedNovelId, setSelectedNovelId] = useState(novels[0]?.id || "");
  const [selectedSeriesId, setSelectedSeriesId] = useState(series[0]?.id || "");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [aliasesText, setAliasesText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please provide an entry name.");
      return;
    }

    if (!seriesScoped && !selectedNovelId) {
      setError("Book-scoped entries must be associated with a novel.");
      return;
    }

    if (seriesScoped && !selectedSeriesId) {
      setError("Series-scoped entries must be associated with a series.");
      return;
    }

    setLoading(true);

    try {
      const aliases = aliasesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await createCodexEntryAction({
        name: trimmedName,
        type,
        trackingMode,
        seriesScoped,
        novelId: seriesScoped ? null : selectedNovelId,
        seriesId: seriesScoped ? selectedSeriesId : null,
        description,
        notes: notes.trim() || null,
        color,
        aliases,
      });

      if (!res.success) {
        setError(res.error || "Failed to create entry.");
        setLoading(false);
        return;
      }

      onCreated(res.data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  return {
    formState: {
      name,
      type,
      trackingMode,
      seriesScoped,
      selectedNovelId,
      selectedSeriesId,
      description,
      notes,
      color,
      aliasesText,
      loading,
      error,
    },
    actions: {
      setName,
      setType,
      setTrackingMode,
      setSeriesScoped,
      setSelectedNovelId,
      setSelectedSeriesId,
      setDescription,
      setNotes,
      setColor,
      setAliasesText,
      handleSubmit,
    },
  };
}
