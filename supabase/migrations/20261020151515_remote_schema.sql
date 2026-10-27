SET local check_function_bodies = off;

COMMENT ON COLUMN "public"."users"."email" IS NULL;

DROP INDEX "public"."acts_novel_id_deleted_at_idx";

DROP INDEX "public"."acts_novel_id_position_idx";

DROP INDEX "public"."chapters_act_id_deleted_at_idx";

DROP INDEX "public"."chapters_act_id_position_idx";

DROP INDEX "public"."codex_aliases_entry_id_deleted_at_idx";

DROP INDEX "public"."codex_aliases_name_idx";

DROP INDEX "public"."codex_entries_novel_id_deleted_at_idx";

DROP INDEX "public"."codex_entries_owner_id_deleted_at_idx";

DROP INDEX "public"."codex_entries_series_id_deleted_at_idx";

DROP INDEX "public"."codex_entries_tracking_mode_idx";

DROP INDEX "public"."codex_entries_type_idx";

DROP INDEX "public"."codex_progressions_entry_id_deleted_at_idx";

DROP INDEX "public"."codex_progressions_scene_id_deleted_at_idx";

DROP INDEX "public"."codex_progressions_scene_id_position_idx";

DROP INDEX "public"."codex_relations_relation_type_idx";

DROP INDEX "public"."codex_relations_source_entry_id_deleted_at_idx";

DROP INDEX "public"."codex_relations_target_entry_id_deleted_at_idx";

DROP INDEX "public"."codex_tags_entry_id_deleted_at_idx";

DROP INDEX "public"."codex_tags_name_idx";

DROP INDEX "public"."novels_owner_id_deleted_at_idx";

DROP INDEX "public"."novels_owner_id_position_idx";

DROP INDEX "public"."novels_series_id_idx";

DROP INDEX "public"."scenes_chapter_id_deleted_at_idx";

DROP INDEX "public"."scenes_chapter_id_position_idx";

DROP INDEX "public"."series_owner_id_deleted_at_idx";

DROP INDEX "public"."series_owner_id_position_idx";

DROP INDEX "public"."users_deleted_at_idx";

DROP INDEX "public"."users_email_key";

ALTER TABLE "public"."acts"
  DROP CONSTRAINT "acts_novel_id_fkey";

ALTER TABLE "public"."chapters"
  DROP CONSTRAINT "chapters_act_id_fkey";

ALTER TABLE "public"."codex_aliases"
  DROP CONSTRAINT "codex_aliases_entry_id_fkey";

ALTER TABLE "public"."codex_entries"
  DROP CONSTRAINT "codex_entries_novel_id_fkey";

ALTER TABLE "public"."codex_entries"
  DROP CONSTRAINT "codex_entries_owner_id_fkey";

ALTER TABLE "public"."codex_entries"
  DROP CONSTRAINT "codex_entries_series_id_fkey";

ALTER TABLE "public"."codex_progressions"
  DROP CONSTRAINT "codex_progressions_entry_id_fkey";

ALTER TABLE "public"."codex_progressions"
  DROP CONSTRAINT "codex_progressions_scene_id_fkey";

ALTER TABLE "public"."codex_relations"
  DROP CONSTRAINT "codex_relations_source_entry_id_fkey";

ALTER TABLE "public"."codex_relations"
  DROP CONSTRAINT "codex_relations_target_entry_id_fkey";

ALTER TABLE "public"."codex_tags"
  DROP CONSTRAINT "codex_tags_entry_id_fkey";

ALTER TABLE "public"."novels"
  DROP CONSTRAINT "novels_owner_id_fkey";

ALTER TABLE "public"."novels"
  DROP CONSTRAINT "novels_series_id_fkey";

ALTER TABLE "public"."scenes"
  DROP CONSTRAINT "scenes_chapter_id_fkey";

ALTER TABLE "public"."series"
  DROP CONSTRAINT "series_owner_id_fkey";

ALTER TABLE "public"."users"
  DROP CONSTRAINT "users_email_key1";

ALTER TABLE "public"."users"
  DROP CONSTRAINT "users_pkey";

ALTER TABLE "public"."codex_entries"
  DROP COLUMN "novel_id";

ALTER TABLE "public"."codex_entries"
  DROP COLUMN "series_id";

ALTER TABLE "public"."users"
  DROP COLUMN "id";

DROP TABLE "prisma_contract"."marker";

DROP EXTENSION "autoinc";

DROP EXTENSION "fuzzystrmatch";

DROP EXTENSION "hypopg";

DROP EXTENSION "index_advisor";

DROP EXTENSION "pg_cron";

DROP EXTENSION "pg_trgm";

DROP EXTENSION "pgmq";

DROP SCHEMA "prisma_contract";

CREATE TABLE "public"."codex" (
  "id"          uuid                        NOT NULL DEFAULT gen_random_uuid(),
  "created_at"  timestamp without time zone NOT NULL DEFAULT now(),
  "name"        text                        NOT NULL,
  "description" text,
  "updated_at"  timestamp without time zone NOT NULL DEFAULT now(),
  "deleted_at"  timestamp without time zone,
  CONSTRAINT "codex_pkey" PRIMARY KEY (id),
  "owner_id"    uuid                        NOT NULL DEFAULT auth.uid()
);

ALTER TABLE "public"."codex_entries"
  ADD COLUMN "world_id" uuid NOT NULL;

ALTER TABLE "public"."novels"
  ADD COLUMN "world_id" uuid;

ALTER TABLE "public"."series"
  ADD COLUMN "world_id" uuid;

ALTER TABLE "public"."acts"
  ALTER COLUMN "created_at" DROP DEFAULT;

ALTER TABLE "public"."acts"
  ALTER COLUMN "created_at" TYPE timestamp WITHOUT time zone USING "created_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."acts"
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."acts"
  ALTER COLUMN "deleted_at" DROP DEFAULT;

ALTER TABLE "public"."acts"
  ALTER COLUMN "deleted_at" TYPE timestamp WITHOUT time zone USING "deleted_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."acts"
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "public"."acts"
  ALTER COLUMN "updated_at" TYPE timestamp WITHOUT time zone USING "updated_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."chapters"
  ALTER COLUMN "created_at" DROP DEFAULT;

ALTER TABLE "public"."chapters"
  ALTER COLUMN "created_at" TYPE timestamp WITHOUT time zone USING "created_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."chapters"
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."chapters"
  ALTER COLUMN "deleted_at" DROP DEFAULT;

ALTER TABLE "public"."chapters"
  ALTER COLUMN "deleted_at" TYPE timestamp WITHOUT time zone USING "deleted_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."chapters"
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "public"."chapters"
  ALTER COLUMN "updated_at" TYPE timestamp WITHOUT time zone USING "updated_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."codex_aliases"
  ALTER COLUMN "created_at" DROP DEFAULT;

ALTER TABLE "public"."codex_aliases"
  ALTER COLUMN "created_at" TYPE timestamp WITHOUT time zone USING "created_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."codex_aliases"
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."codex_aliases"
  ALTER COLUMN "deleted_at" DROP DEFAULT;

ALTER TABLE "public"."codex_aliases"
  ALTER COLUMN "deleted_at" TYPE timestamp WITHOUT time zone USING "deleted_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."codex_aliases"
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "public"."codex_aliases"
  ALTER COLUMN "updated_at" TYPE timestamp WITHOUT time zone USING "updated_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."codex_entries"
  ALTER COLUMN "created_at" DROP DEFAULT;

ALTER TABLE "public"."codex_entries"
  ALTER COLUMN "created_at" TYPE timestamp WITHOUT time zone USING "created_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."codex_entries"
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."codex_entries"
  ALTER COLUMN "deleted_at" DROP DEFAULT;

ALTER TABLE "public"."codex_entries"
  ALTER COLUMN "deleted_at" TYPE timestamp WITHOUT time zone USING "deleted_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."codex_entries"
  ALTER COLUMN "owner_id" DROP DEFAULT;

ALTER TABLE "public"."codex_entries"
  ALTER COLUMN "owner_id" TYPE uuid USING "owner_id"::uuid;

ALTER TABLE "public"."codex_entries"
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "public"."codex_entries"
  ALTER COLUMN "updated_at" TYPE timestamp WITHOUT time zone USING "updated_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."codex_progressions"
  ALTER COLUMN "created_at" DROP DEFAULT;

ALTER TABLE "public"."codex_progressions"
  ALTER COLUMN "created_at" TYPE timestamp WITHOUT time zone USING "created_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."codex_progressions"
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."codex_progressions"
  ALTER COLUMN "deleted_at" DROP DEFAULT;

ALTER TABLE "public"."codex_progressions"
  ALTER COLUMN "deleted_at" TYPE timestamp WITHOUT time zone USING "deleted_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."codex_progressions"
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "public"."codex_progressions"
  ALTER COLUMN "updated_at" TYPE timestamp WITHOUT time zone USING "updated_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."codex_relations"
  ALTER COLUMN "created_at" DROP DEFAULT;

ALTER TABLE "public"."codex_relations"
  ALTER COLUMN "created_at" TYPE timestamp WITHOUT time zone USING "created_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."codex_relations"
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."codex_relations"
  ALTER COLUMN "deleted_at" DROP DEFAULT;

ALTER TABLE "public"."codex_relations"
  ALTER COLUMN "deleted_at" TYPE timestamp WITHOUT time zone USING "deleted_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."codex_relations"
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "public"."codex_relations"
  ALTER COLUMN "updated_at" TYPE timestamp WITHOUT time zone USING "updated_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."codex_tags"
  ALTER COLUMN "created_at" DROP DEFAULT;

ALTER TABLE "public"."codex_tags"
  ALTER COLUMN "created_at" TYPE timestamp WITHOUT time zone USING "created_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."codex_tags"
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."codex_tags"
  ALTER COLUMN "deleted_at" DROP DEFAULT;

ALTER TABLE "public"."codex_tags"
  ALTER COLUMN "deleted_at" TYPE timestamp WITHOUT time zone USING "deleted_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."codex_tags"
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "public"."codex_tags"
  ALTER COLUMN "updated_at" TYPE timestamp WITHOUT time zone USING "updated_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."novels"
  ALTER COLUMN "created_at" DROP DEFAULT;

ALTER TABLE "public"."novels"
  ALTER COLUMN "created_at" TYPE timestamp WITHOUT time zone USING "created_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."novels"
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."novels"
  ALTER COLUMN "deleted_at" DROP DEFAULT;

ALTER TABLE "public"."novels"
  ALTER COLUMN "deleted_at" TYPE timestamp WITHOUT time zone USING "deleted_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."novels"
  ALTER COLUMN "owner_id" DROP DEFAULT;

ALTER TABLE "public"."novels"
  ALTER COLUMN "owner_id" TYPE uuid USING "owner_id"::uuid;

ALTER TABLE "public"."novels"
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "public"."novels"
  ALTER COLUMN "updated_at" TYPE timestamp WITHOUT time zone USING "updated_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."scenes"
  ALTER COLUMN "created_at" DROP DEFAULT;

ALTER TABLE "public"."scenes"
  ALTER COLUMN "created_at" TYPE timestamp WITHOUT time zone USING "created_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."scenes"
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."scenes"
  ALTER COLUMN "deleted_at" DROP DEFAULT;

ALTER TABLE "public"."scenes"
  ALTER COLUMN "deleted_at" TYPE timestamp WITHOUT time zone USING "deleted_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."scenes"
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "public"."scenes"
  ALTER COLUMN "updated_at" TYPE timestamp WITHOUT time zone USING "updated_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."series"
  ALTER COLUMN "created_at" DROP DEFAULT;

ALTER TABLE "public"."series"
  ALTER COLUMN "created_at" TYPE timestamp WITHOUT time zone USING "created_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."series"
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."series"
  ALTER COLUMN "deleted_at" DROP DEFAULT;

ALTER TABLE "public"."series"
  ALTER COLUMN "deleted_at" TYPE timestamp WITHOUT time zone USING "deleted_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."series"
  ALTER COLUMN "owner_id" DROP DEFAULT;

ALTER TABLE "public"."series"
  ALTER COLUMN "owner_id" TYPE uuid USING "owner_id"::uuid;

ALTER TABLE "public"."series"
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "public"."series"
  ALTER COLUMN "updated_at" TYPE timestamp WITHOUT time zone USING "updated_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."users"
  ALTER COLUMN "created_at" DROP DEFAULT;

ALTER TABLE "public"."users"
  ALTER COLUMN "created_at" TYPE timestamp WITHOUT time zone USING "created_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."users"
  ALTER COLUMN "created_at" SET DEFAULT now();

ALTER TABLE "public"."users"
  ALTER COLUMN "deleted_at" DROP DEFAULT;

ALTER TABLE "public"."users"
  ALTER COLUMN "deleted_at" TYPE timestamp WITHOUT time zone USING "deleted_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."users"
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "public"."users"
  ALTER COLUMN "updated_at" TYPE timestamp WITHOUT time zone USING "updated_at"::timestamp WITHOUT time zone;

ALTER TABLE "public"."users"
  ALTER COLUMN "updated_at" SET DEFAULT now();

ALTER TABLE "public"."users"
  ALTER COLUMN "created_at" SET DEFAULT now();

ALTER TABLE "public"."users"
  ALTER COLUMN "updated_at" SET DEFAULT now();

CREATE OR REPLACE FUNCTION public.sync_public_user_email_from_auth()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  UPDATE public.users
  SET email = NEW.email,
      updated_at = CURRENT_TIMESTAMP
  WHERE user_id = NEW.id;

  RETURN NEW;
END;
$function$;

ALTER TABLE "public"."acts"
  ADD CONSTRAINT "acts_novel_id_fkey" FOREIGN KEY (novel_id) REFERENCES public.novels(id);

ALTER TABLE "public"."chapters"
  ADD CONSTRAINT "chapters_act_id_fkey" FOREIGN KEY (act_id) REFERENCES public.acts(id);

ALTER TABLE "public"."codex_aliases"
  ADD CONSTRAINT "codex_aliases_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES public.codex_entries(id);

ALTER TABLE "public"."codex_entries"
  ADD CONSTRAINT "codex_entries_world_id_fkey" FOREIGN KEY (world_id) REFERENCES public.codex(id);

ALTER TABLE "public"."codex_progressions"
  ADD CONSTRAINT "codex_progressions_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES public.codex_entries(id);

ALTER TABLE "public"."codex_progressions"
  ADD CONSTRAINT "codex_progressions_scene_id_fkey" FOREIGN KEY (scene_id) REFERENCES public.scenes(id);

ALTER TABLE "public"."codex_relations"
  ADD CONSTRAINT "codex_relations_source_entry_id_fkey" FOREIGN KEY (source_entry_id) REFERENCES public.codex_entries(id);

ALTER TABLE "public"."codex_relations"
  ADD CONSTRAINT "codex_relations_target_entry_id_fkey" FOREIGN KEY (target_entry_id) REFERENCES public.codex_entries(id);

ALTER TABLE "public"."codex_tags"
  ADD CONSTRAINT "codex_tags_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES public.codex_entries(id);

ALTER TABLE "public"."novels"
  ADD CONSTRAINT "novels_series_id_fkey" FOREIGN KEY (series_id) REFERENCES public.series(id);

ALTER TABLE "public"."novels"
  ADD CONSTRAINT "novels_world_id_fkey" FOREIGN KEY (world_id) REFERENCES public.codex(id);

ALTER TABLE "public"."scenes"
  ADD CONSTRAINT "scenes_chapter_id_fkey" FOREIGN KEY (chapter_id) REFERENCES public.chapters(id);

ALTER TABLE "public"."series"
  ADD CONSTRAINT "series_world_id_fkey" FOREIGN KEY (world_id) REFERENCES public.codex(id);

CREATE TRIGGER sync_public_user_email_on_auth_update
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN ((((old.email)::text IS DISTINCT FROM (new.email)::text) AND (new.email IS NOT NULL)))
  EXECUTE FUNCTION public.sync_public_user_email_from_auth();

GRANT EXECUTE ON FUNCTION "public"."sync_public_user_email_from_auth"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."sync_public_user_email_from_auth"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."sync_public_user_email_from_auth"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."sync_public_user_email_from_auth"() TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."codex" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."codex" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."codex" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."codex" TO "service_role";

ALTER TABLE "public"."users"
  ADD COLUMN "user_id" uuid NOT NULL DEFAULT auth.uid();

ALTER TABLE "public"."users"
  ADD CONSTRAINT "users_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE "public"."users"
  ADD CONSTRAINT "users_pkey" PRIMARY KEY (user_id);

ALTER TABLE "public"."codex"
  ADD CONSTRAINT "codex_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES public.users(user_id);

ALTER TABLE "public"."codex_entries"
  ADD CONSTRAINT "codex_entries_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES public.users(user_id);

ALTER TABLE "public"."novels"
  ADD CONSTRAINT "novels_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES public.users(user_id);

ALTER TABLE "public"."series"
  ADD CONSTRAINT "series_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES public.users(user_id);

