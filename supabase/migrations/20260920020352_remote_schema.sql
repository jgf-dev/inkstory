SET local check_function_bodies = off;

CREATE SCHEMA "prisma_contract";

CREATE EXTENSION "autoinc" SCHEMA "extensions";

CREATE EXTENSION "fuzzystrmatch" SCHEMA "extensions";

CREATE EXTENSION "hypopg" SCHEMA "extensions";

CREATE EXTENSION "index_advisor" SCHEMA "extensions";

CREATE EXTENSION "pg_cron";

CREATE EXTENSION "pg_trgm" SCHEMA "extensions";

CREATE EXTENSION "pgmq";

CREATE TABLE "prisma_contract"."marker" (
  "space"             text                     NOT NULL DEFAULT 'app'::text,
  "core_hash"         text                     NOT NULL,
  "profile_hash"      text                     NOT NULL,
  "contract_json"     jsonb,
  "canonical_version" integer,
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "app_tag"           text,
  "meta"              jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "invariants"        text[]                   NOT NULL DEFAULT '{}'::text[],
  CONSTRAINT "marker_pkey" PRIMARY KEY (space)
);

CREATE TABLE "public"."acts" (
  "id"         text                           NOT NULL,
  "title"      text                           NOT NULL,
  "position"   integer                        NOT NULL DEFAULT 0,
  "created_at" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) without time zone NOT NULL,
  "deleted_at" timestamp(3) without time zone,
  "novel_id"   text                           NOT NULL,
  CONSTRAINT "acts_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."chapters" (
  "id"         text                           NOT NULL,
  "title"      text                           NOT NULL,
  "position"   integer                        NOT NULL DEFAULT 0,
  "created_at" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) without time zone NOT NULL,
  "deleted_at" timestamp(3) without time zone,
  "act_id"     text                           NOT NULL,
  CONSTRAINT "chapters_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."codex_aliases" (
  "id"         text                           NOT NULL,
  "name"       text                           NOT NULL,
  "created_at" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) without time zone NOT NULL,
  "deleted_at" timestamp(3) without time zone,
  "entry_id"   text                           NOT NULL,
  CONSTRAINT "codex_aliases_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."codex_entries" (
  "id"            text                           NOT NULL,
  "name"          text                           NOT NULL,
  "description"   text                           NOT NULL DEFAULT ''::text,
  "notes"         text,
  "series_scoped" boolean                        NOT NULL DEFAULT false,
  "custom_fields" jsonb,
  "color"         text,
  "thumbnail_url" text,
  "position"      integer                        NOT NULL DEFAULT 0,
  "created_at"    timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    timestamp(3) without time zone NOT NULL,
  "deleted_at"    timestamp(3) without time zone,
  "owner_id"      text                           NOT NULL,
  "novel_id"      text,
  "series_id"     text,
  CONSTRAINT "codex_entries_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."codex_progressions" (
  "id"          text                           NOT NULL,
  "description" text                           NOT NULL,
  "notes"       text,
  "position"    integer                        NOT NULL DEFAULT 0,
  "created_at"  timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  timestamp(3) without time zone NOT NULL,
  "deleted_at"  timestamp(3) without time zone,
  "entry_id"    text                           NOT NULL,
  "scene_id"    text                           NOT NULL,
  CONSTRAINT "codex_progressions_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."codex_relations" (
  "id"              text                           NOT NULL,
  "relation_type"   text                           NOT NULL,
  "reverse_type"    text,
  "description"     text,
  "created_at"      timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      timestamp(3) without time zone NOT NULL,
  "deleted_at"      timestamp(3) without time zone,
  "source_entry_id" text                           NOT NULL,
  "target_entry_id" text                           NOT NULL,
  CONSTRAINT "codex_relations_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."codex_tags" (
  "id"         text                           NOT NULL,
  "name"       text                           NOT NULL,
  "color"      text,
  "created_at" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) without time zone NOT NULL,
  "deleted_at" timestamp(3) without time zone,
  "entry_id"   text                           NOT NULL,
  CONSTRAINT "codex_tags_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."novels" (
  "id"          text                           NOT NULL,
  "title"       text                           NOT NULL,
  "subtitle"    text,
  "description" text,
  "position"    integer                        NOT NULL DEFAULT 0,
  "created_at"  timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  timestamp(3) without time zone NOT NULL,
  "deleted_at"  timestamp(3) without time zone,
  "owner_id"    text                           NOT NULL,
  "series_id"   text,
  CONSTRAINT "novels_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."scenes" (
  "id"              text                           NOT NULL,
  "title"           text                           NOT NULL,
  "label"           text,
  "subtitle"        text,
  "content"         text                           NOT NULL DEFAULT ''::text,
  "summary"         text,
  "position"        integer                        NOT NULL DEFAULT 0,
  "exclude_from_ai" boolean                        NOT NULL DEFAULT false,
  "word_count"      integer                        NOT NULL DEFAULT 0,
  "created_at"      timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      timestamp(3) without time zone NOT NULL,
  "deleted_at"      timestamp(3) without time zone,
  "chapter_id"      text                           NOT NULL,
  CONSTRAINT "scenes_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."series" (
  "id"          text                           NOT NULL,
  "title"       text                           NOT NULL,
  "description" text,
  "position"    integer                        NOT NULL DEFAULT 0,
  "created_at"  timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  timestamp(3) without time zone NOT NULL,
  "deleted_at"  timestamp(3) without time zone,
  "owner_id"    text                           NOT NULL,
  CONSTRAINT "series_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."users" (
  "id"         text                           NOT NULL,
  "email"      text                           NOT NULL,
  "name"       text,
  "avatar_url" text,
  "created_at" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) without time zone NOT NULL,
  "deleted_at" timestamp(3) without time zone,
  CONSTRAINT "users_email_key1" UNIQUE (email),
  CONSTRAINT "users_pkey" PRIMARY KEY (id)
);

CREATE TYPE "public"."CodexTrackingMode" AS ENUM (
  'ALWAYS',
  'DETECTED',
  'NEVER'
);

ALTER TABLE "public"."codex_entries"
  ADD COLUMN "tracking_mode" public."CodexTrackingMode" NOT NULL DEFAULT 'DETECTED'::public."CodexTrackingMode";

CREATE TYPE "public"."CodexType" AS ENUM (
  'CHARACTER',
  'LOCATION',
  'ITEM',
  'LORE',
  'FACTION',
  'CONCEPT',
  'OTHER'
);

ALTER TABLE "public"."codex_entries"
  ADD COLUMN "type" public."CodexType" NOT NULL DEFAULT 'CHARACTER'::public."CodexType";

CREATE TYPE "public"."Pov" AS ENUM (
  'FIRST',
  'SECOND',
  'THIRD_LIMITED',
  'THIRD_OMNISCIENT'
);

ALTER TABLE "public"."scenes"
  ADD COLUMN "pov" public."Pov" NOT NULL DEFAULT 'THIRD_LIMITED'::public."Pov";

CREATE TYPE "public"."ProgressionMode" AS ENUM (
  'ADDITION',
  'REPLACEMENT'
);

ALTER TABLE "public"."codex_progressions"
  ADD COLUMN "mode" public."ProgressionMode" NOT NULL DEFAULT 'ADDITION'::public."ProgressionMode";

CREATE TYPE "public"."Tense" AS ENUM (
  'PAST',
  'PRESENT',
  'FUTURE'
);

ALTER TABLE "public"."scenes"
  ADD COLUMN "tense" public."Tense" NOT NULL DEFAULT 'PAST'::public."Tense";

ALTER TABLE "public"."chapters"
  ADD CONSTRAINT "chapters_act_id_fkey" FOREIGN KEY (act_id) REFERENCES public.acts(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "public"."codex_aliases"
  ADD CONSTRAINT "codex_aliases_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES public.codex_entries(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "public"."codex_progressions"
  ADD CONSTRAINT "codex_progressions_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES public.codex_entries(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "public"."codex_relations"
  ADD CONSTRAINT "codex_relations_source_entry_id_fkey" FOREIGN KEY (source_entry_id) REFERENCES public.codex_entries(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "public"."codex_relations"
  ADD CONSTRAINT "codex_relations_target_entry_id_fkey" FOREIGN KEY (target_entry_id) REFERENCES public.codex_entries(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "public"."codex_tags"
  ADD CONSTRAINT "codex_tags_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES public.codex_entries(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "public"."acts"
  ADD CONSTRAINT "acts_novel_id_fkey" FOREIGN KEY (novel_id) REFERENCES public.novels(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "public"."codex_entries"
  ADD CONSTRAINT "codex_entries_novel_id_fkey" FOREIGN KEY (novel_id) REFERENCES public.novels(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "public"."scenes"
  ADD CONSTRAINT "scenes_chapter_id_fkey" FOREIGN KEY (chapter_id) REFERENCES public.chapters(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "public"."codex_progressions"
  ADD CONSTRAINT "codex_progressions_scene_id_fkey" FOREIGN KEY (scene_id) REFERENCES public.scenes(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "public"."codex_entries"
  ADD CONSTRAINT "codex_entries_series_id_fkey" FOREIGN KEY (series_id) REFERENCES public.series(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "public"."novels"
  ADD CONSTRAINT "novels_series_id_fkey" FOREIGN KEY (series_id) REFERENCES public.series(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE "public"."codex_entries"
  ADD CONSTRAINT "codex_entries_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "public"."novels"
  ADD CONSTRAINT "novels_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "public"."series"
  ADD CONSTRAINT "series_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX acts_novel_id_deleted_at_idx ON public.acts USING btree (novel_id, deleted_at);

CREATE INDEX acts_novel_id_position_idx ON public.acts USING btree (novel_id, "position");

CREATE INDEX chapters_act_id_deleted_at_idx ON public.chapters USING btree (act_id, deleted_at);

CREATE INDEX chapters_act_id_position_idx ON public.chapters USING btree (act_id, "position");

CREATE INDEX codex_aliases_entry_id_deleted_at_idx ON public.codex_aliases USING btree (entry_id, deleted_at);

CREATE INDEX codex_aliases_name_idx ON public.codex_aliases USING btree (name);

CREATE INDEX codex_entries_novel_id_deleted_at_idx ON public.codex_entries USING btree (novel_id, deleted_at);

CREATE INDEX codex_entries_owner_id_deleted_at_idx ON public.codex_entries USING btree (owner_id, deleted_at);

CREATE INDEX codex_entries_series_id_deleted_at_idx ON public.codex_entries USING btree (series_id, deleted_at);

CREATE INDEX codex_entries_tracking_mode_idx ON public.codex_entries USING btree (tracking_mode);

CREATE INDEX codex_entries_type_idx ON public.codex_entries USING btree (TYPE);

CREATE INDEX codex_progressions_entry_id_deleted_at_idx ON public.codex_progressions USING btree (entry_id, deleted_at);

CREATE INDEX codex_progressions_scene_id_deleted_at_idx ON public.codex_progressions USING btree (scene_id, deleted_at);

CREATE INDEX codex_progressions_scene_id_position_idx ON public.codex_progressions USING btree (scene_id, "position");

CREATE INDEX codex_relations_relation_type_idx ON public.codex_relations USING btree (relation_type);

CREATE INDEX codex_relations_source_entry_id_deleted_at_idx ON public.codex_relations USING btree (source_entry_id, deleted_at);

CREATE INDEX codex_relations_target_entry_id_deleted_at_idx ON public.codex_relations USING btree (target_entry_id, deleted_at);

CREATE INDEX codex_tags_entry_id_deleted_at_idx ON public.codex_tags USING btree (entry_id, deleted_at);

CREATE INDEX codex_tags_name_idx ON public.codex_tags USING btree (name);

CREATE INDEX novels_owner_id_deleted_at_idx ON public.novels USING btree (owner_id, deleted_at);

CREATE INDEX novels_owner_id_position_idx ON public.novels USING btree (owner_id, "position");

CREATE INDEX novels_series_id_idx ON public.novels USING btree (series_id);

CREATE INDEX scenes_chapter_id_deleted_at_idx ON public.scenes USING btree (chapter_id, deleted_at);

CREATE INDEX scenes_chapter_id_position_idx ON public.scenes USING btree (chapter_id, "position");

CREATE INDEX series_owner_id_deleted_at_idx ON public.series USING btree (owner_id, deleted_at);

CREATE INDEX series_owner_id_position_idx ON public.series USING btree (owner_id, "position");

CREATE INDEX users_deleted_at_idx ON public.users USING btree (deleted_at);

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);

COMMENT ON COLUMN "public"."users"."email" IS '[SENSITIVE]';

COMMENT ON EXTENSION "autoinc" IS 'functions for autoincrementing fields';

COMMENT ON EXTENSION "fuzzystrmatch" IS 'determine similarities and distance between strings';

COMMENT ON EXTENSION "hypopg" IS 'Hypothetical indexes for PostgreSQL';

COMMENT ON EXTENSION "index_advisor" IS 'Query index advisor';

COMMENT ON EXTENSION "pg_cron" IS 'Job scheduler for PostgreSQL';

COMMENT ON EXTENSION "pg_trgm" IS 'text similarity measurement and index searching based on trigrams';

COMMENT ON EXTENSION "pgmq" IS 'A lightweight message queue. Like AWS SQS and RSMQ but on Postgres.';

GRANT CREATE, USAGE ON SCHEMA "prisma_contract" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "prisma_contract"."marker" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."acts" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."chapters" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."codex_aliases" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."codex_entries" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."codex_progressions" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."codex_relations" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."codex_tags" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."novels" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."scenes" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."series" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."users" TO "anon", "authenticated", "postgres", "service_role";

GRANT USAGE ON TYPE "public"."CodexTrackingMode" TO "postgres";

GRANT USAGE ON TYPE "public"."CodexType" TO "postgres";

GRANT USAGE ON TYPE "public"."Pov" TO "postgres";

GRANT USAGE ON TYPE "public"."ProgressionMode" TO "postgres";

GRANT USAGE ON TYPE "public"."Tense" TO "postgres";
