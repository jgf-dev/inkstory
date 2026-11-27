import {
  FaqSection,
  MoreToolsSection,
  SelectField,
  SubmitRow,
  ToolHeader,
  ToolLink,
  WaitlistCta,
  renderOptions,
  toolMetadata,
} from "@/app/_components/tools/ToolPage";
import {
  ANY,
  MAX_COUNT,
  MIN_COUNT,
  TROPE_CATEGORIES,
  TROPE_GENERATOR_PATH,
  TROPE_GENRES,
  buildTropeGeneratorHref,
  createRandomSeed,
  generateTropes,
  nextSeed,
  parseTropeGeneratorParams,
  toggleLock,
  type SearchParamsRecord,
} from "@/lib/tools/story-tropes";
import { FAQS, INTRO, OG_TITLE, PAGE_DESCRIPTION, PAGE_HEADING, PAGE_TITLE } from "./content";
import { TropeResults } from "./TropeResults";

export const metadata = toolMetadata({
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  ogTitle: OG_TITLE,
  keywords: [
    "free story tropes generator",
    "story trope generator",
    "random trope generator",
    "writing prompt generator",
  ],
  path: TROPE_GENERATOR_PATH,
});

const GENRE_LABELS: Record<(typeof TROPE_GENRES)[number], string> = {
  fantasy: "Fantasy",
  "sci-fi": "Science fiction",
  romance: "Romance",
  mystery: "Mystery",
  thriller: "Thriller",
  horror: "Horror",
  contemporary: "Contemporary",
  historical: "Historical",
};

const CATEGORY_LABELS: Record<(typeof TROPE_CATEGORIES)[number], string> = {
  romance: "Romance",
  plot: "Plot",
  character: "Character",
  setting: "Setting",
  tone: "Tone",
};

const GENRE_OPTIONS = [
  { value: ANY, label: "Any genre" },
  ...TROPE_GENRES.map((genre) => ({ value: genre, label: GENRE_LABELS[genre] })),
];
const CATEGORY_OPTIONS = [
  { value: ANY, label: "Mix every type" },
  ...TROPE_CATEGORIES.map((category) => ({ value: category, label: CATEGORY_LABELS[category] })),
];
const COUNT_OPTIONS = Array.from({ length: MAX_COUNT - MIN_COUNT + 1 }, (_, i) => {
  const value = String(MIN_COUNT + i);
  return { value, label: value };
});

/** Public story trope generator; no auth. The combo is SSR-rendered from the query string. */
export default async function StoryTropeGeneratorPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsRecord>;
} = {}) {
  const params = parseTropeGeneratorParams(searchParams ? await searchParams : undefined);
  const seed = params.seed ?? createRandomSeed();
  const combo = generateTropes({ ...params, seed });
  const locked = combo.filter((entry) => entry.locked).map((entry) => entry.trope.id);
  const shareHref = buildTropeGeneratorHref(seed, params, locked);
  const freshSeed = nextSeed(seed);
  const moreHref = buildTropeGeneratorHref(freshSeed, params, locked);
  const tropes = combo.map(({ trope, locked: isLocked }) => ({
    id: trope.id,
    name: trope.name,
    description: trope.description,
    category: trope.category,
    locked: isLocked,
    toggleHref: buildTropeGeneratorHref(seed, params, toggleLock(locked, trope.id)),
  }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <ToolHeader heading={PAGE_HEADING} intro={INTRO} />

      <form
        method="get"
        action={TROPE_GENERATOR_PATH}
        className="grid gap-4 sm:grid-cols-3"
        aria-label="Trope filters"
      >
        {/* A new seed per submit keeps the resulting URL shareable; locks carry over. */}
        <input type="hidden" name="seed" value={freshSeed} />
        {locked.length > 0 ? <input type="hidden" name="lock" value={locked.join(",")} /> : null}
        <SelectField id="tg-genre" name="genre" label="Genre" value={params.genre}>
          {renderOptions(GENRE_OPTIONS)}
        </SelectField>
        <SelectField id="tg-category" name="category" label="Trope type" value={params.category}>
          {renderOptions(CATEGORY_OPTIONS)}
        </SelectField>
        <SelectField
          id="tg-count"
          name="count"
          label="Number of tropes"
          value={String(params.count)}
        >
          {renderOptions(COUNT_OPTIONS)}
        </SelectField>
        <SubmitRow label="Generate tropes" />
      </form>

      <TropeResults tropes={tropes} shareHref={shareHref} moreHref={moreHref} />

      <FaqSection heading="Story trope generator FAQ" faqs={FAQS} />

      <MoreToolsSection>
        Have a premise and need a cast? Try the{" "}
        <ToolLink href="/tools/character-name-generator">character name generator</ToolLink>.
      </MoreToolsSection>

      <WaitlistCta
        title="Turn tropes into a draft"
        body="syncodex is a writing workspace for novelists, with a story bible for your characters, places and lore, and a scene editor with an AI assistant that reads it."
        source="story-trope-generator"
      />
    </main>
  );
}
