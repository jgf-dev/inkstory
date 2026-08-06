/**
 * Supabase Database type. Stubbed for Epic 0 — `supabase gen types typescript`
 * will regenerate this once Storage buckets and other tables exist.
 *
 * Keeping the file present lets `@supabase/ssr` create strongly typed clients
 * from day one.
 */
export type Database = {
  public: {
    Tables: Record<
      string,
      {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      }
    >;
    Views: Record<string, { Row: Record<string, unknown> }>;
    Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>;
    Enums: Record<string, string>;
  };
};
