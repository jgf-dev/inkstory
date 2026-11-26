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
  HEAT_LEVELS,
  PAIRINGS,
  PROMPT_GENERATOR_PATH,
  PROMPT_GENRES,
  PROMPT_TROPES,
  buildPromptGeneratorHref,
  createRandomSeed,
  generatePrompt,
  nextSeed,
  parsePromptGeneratorParams,
  toggleLock,
  type GenreFilter,
  type PromptSlot,
  type PromptTrope,
  type SearchParamsRecord,
} from "@/lib/tools/adult-prompts";
import {
  ADULTS_ONLY_NOTICE,
  FAQS,
  INTRO,
  OG_TITLE,
  PAGE_DESCRIPTION,
  PAGE_HEADING,
  PAGE_TITLE,
} from "./content";
import { PromptResults } from "./PromptResults";

export const metadata = {
  ...toolMetadata({
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    ogTitle: OG_TITLE,
    keywords: [
      "adult writing prompt generator",
      "free adult writing prompt generator",
      "romance writing prompt generator",
      "spicy writing prompts",
    ],
    path: PROMPT_GENERATOR_PATH,
  }),
  // Held out of search until Jeremy clears the STO-1315 launch blockers
  // (age gate, /privacy and /terms, payments review). Remove to go live.
  robots: { index: false, follow: true },
};

const SLOT_LABELS: Record<PromptSlot, string> = {
  setup: "Situation",
  pairing: "Pairing",
  setting: "Setting",
  tension: "Tension",
  tone: "Heat and tone",
};

const PAIRING_OPTIONS = [
  { value: ANY, label: "Any pairing" },
  ...PAIRINGS.map((pairing) => ({ value: pairing, label: pairing.toUpperCase() })),
];
const HEAT_OPTIONS = [
  { value: ANY, label: "Any heat" },
  { value: HEAT_LEVELS[0], label: "Sweet (closed door)" },
  { value: HEAT_LEVELS[1], label: "Steamy" },
  { value: HEAT_LEVELS[2], label: "Spicy (open door)" },
];
const GENRE_LABELS: Record<Exclude<GenreFilter, typeof ANY>, string> = {
  romance: "Romance",
  "dark-romance": "Dark romance",
  fantasy: "Spicy fantasy",
  contemporary: "Contemporary",
  historical: "Historical",
};
const GENRE_OPTIONS = [
  { value: ANY, label: "Any genre" },
  ...PROMPT_GENRES.map((genre) => ({ value: genre, label: GENRE_LABELS[genre] })),
];

function tropeLabel(trope: PromptTrope): string {
  const label = trope.replace(/-/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const TROPE_OPTIONS = [
  { value: ANY, label: "Any trope" },
  ...PROMPT_TROPES.map((trope) => ({ value: trope, label: tropeLabel(trope) })),
];

/** Public adult writing prompt generator; no auth. The prompt is SSR-rendered from the query string. */
export default async function AdultWritingPromptGeneratorPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsRecord>;
} = {}) {
  const params = parsePromptGeneratorParams(searchParams ? await searchParams : undefined);
  const seed = params.seed ?? createRandomSeed();
  const result = generatePrompt({ ...params, seed });
  const entries = result.slots.flatMap(({ slot, fragments }) =>
    fragments.map((entry) => ({ slot, ...entry })),
  );
  const locked = entries.filter((entry) => entry.locked).map((entry) => entry.fragment.id);
  const shareHref = buildPromptGeneratorHref(seed, params, locked);
  const freshSeed = nextSeed(seed);
  const moreHref = buildPromptGeneratorHref(freshSeed, params, locked);
  const parts = entries.map(({ slot, fragment, locked: isLocked }) => ({
    id: fragment.id,
    label: SLOT_LABELS[slot],
    text: fragment.text,
    locked: isLocked,
    toggleHref: buildPromptGeneratorHref(seed, params, toggleLock(locked, fragment.id)),
  }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <ToolHeader heading={PAGE_HEADING} intro={INTRO} />
      <p className="border-ink-200 text-ink-700 -mt-4 mb-8 rounded-md border px-3 py-2 text-sm">
        {ADULTS_ONLY_NOTICE}
      </p>

      <form
        method="get"
        action={PROMPT_GENERATOR_PATH}
        className="grid gap-4 sm:grid-cols-2"
        aria-label="Prompt filters"
      >
        {/* A new seed per submit keeps the resulting URL shareable; locks carry over. */}
        <input type="hidden" name="seed" value={freshSeed} />
        {locked.length > 0 ? <input type="hidden" name="lock" value={locked.join(",")} /> : null}
        <SelectField id="ap-pairing" name="pairing" label="Pairing" value={params.pairing}>
          {renderOptions(PAIRING_OPTIONS)}
        </SelectField>
        <SelectField id="ap-heat" name="heat" label="Heat level" value={params.heat}>
          {renderOptions(HEAT_OPTIONS)}
        </SelectField>
        <SelectField id="ap-genre" name="genre" label="Genre" value={params.genre}>
          {renderOptions(GENRE_OPTIONS)}
        </SelectField>
        <SelectField id="ap-trope" name="trope" label="Trope" value={params.trope}>
          {renderOptions(TROPE_OPTIONS)}
        </SelectField>
        <SubmitRow label="Generate prompt" />
      </form>

      <PromptResults prompt={result.text} parts={parts} shareHref={shareHref} moreHref={moreHref} />

      <FaqSection heading="Adult writing prompt generator FAQ" faqs={FAQS} />

      <MoreToolsSection>
        Need names for the pair? Try the{" "}
        <ToolLink href="/tools/character-name-generator">character name generator</ToolLink>, or
        build a bigger premise with the{" "}
        <ToolLink href="/tools/story-trope-generator">story trope generator</ToolLink>.
      </MoreToolsSection>

      <WaitlistCta
        title="Write the whole book, not just the scene"
        body="syncodex is a writing workspace for novelists, with a story bible for your characters, places and lore, and a scene editor with an AI assistant that reads it."
        source="adult-writing-prompt-generator"
      />
    </main>
  );
}
