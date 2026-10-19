import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { syncAuthUser } from "@/lib/supabase/auth";
import { CodexError } from "@/lib/codex/errors";
import { getNovelOutline } from "@/lib/writing/service";
import { WritingWorkspace } from "./_components/WritingWorkspace";

export const dynamic = "force-dynamic";

/**
 * Author writing surface (launch phase 3): outliner sidebar, scene editor,
 * and the context/AI drawers for a single novel.
 */
export default async function NovelWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  await syncAuthUser(user);
  const { id } = await params;

  let outline;
  try {
    outline = await getNovelOutline(user.id, id);
  } catch (err) {
    if (err instanceof CodexError && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) {
      notFound();
    }
    throw err;
  }

  const firstSceneId = outline.acts
    .flatMap((act) => act.chapters)
    .flatMap((chapter) => chapter.scenes)[0]?.id;

  return <WritingWorkspace outline={outline} initialSceneId={firstSceneId ?? null} />;
}
