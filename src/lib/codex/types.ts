export type CodexType =
  | "CHARACTER"
  | "LOCATION"
  | "ITEM"
  | "LORE"
  | "FACTION"
  | "CONCEPT"
  | "OTHER";

export type CodexTrackingMode = "ALWAYS" | "DETECTED" | "NEVER";

export type ProgressionMode = "ADDITION" | "REPLACEMENT";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue | undefined }
  | JsonValue[];

export interface CreateCodexEntryInput {
  name: string;
  type?: CodexType;
  description?: string;
  notes?: string | null;
  trackingMode?: CodexTrackingMode;
  seriesScoped?: boolean;
  novelId?: string | null;
  seriesId?: string | null;
  customFields?: Record<string, JsonValue> | null;
  color?: string | null;
  thumbnailUrl?: string | null;
  position?: number;
  aliases?: string[];
  tags?: Array<{ name: string; color?: string | null }>;
}

export interface UpdateCodexEntryInput {
  name?: string;
  type?: CodexType;
  description?: string;
  notes?: string | null;
  trackingMode?: CodexTrackingMode;
  seriesScoped?: boolean;
  novelId?: string | null;
  seriesId?: string | null;
  customFields?: Record<string, JsonValue> | null;
  color?: string | null;
  thumbnailUrl?: string | null;
  position?: number;
}

export interface CodexEntryFilter {
  novelId?: string;
  seriesId?: string;
  type?: CodexType;
  trackingMode?: CodexTrackingMode;
  search?: string;
  seriesOnly?: boolean;
}

export interface CreateCodexAliasInput {
  entryId: string;
  name: string;
}

export interface CreateCodexTagInput {
  entryId: string;
  name: string;
  color?: string | null;
}

export interface CreateCodexRelationInput {
  sourceEntryId: string;
  targetEntryId: string;
  relationType: string;
  reverseType?: string | null;
  description?: string | null;
}

export interface UpdateCodexRelationInput {
  relationType?: string;
  reverseType?: string | null;
  description?: string | null;
}

export interface CreateCodexProgressionInput {
  entryId: string;
  sceneId: string;
  mode?: ProgressionMode;
  description: string;
  notes?: string | null;
  position?: number;
}

export interface UpdateCodexProgressionInput {
  mode?: ProgressionMode;
  description?: string;
  notes?: string | null;
  position?: number;
}
