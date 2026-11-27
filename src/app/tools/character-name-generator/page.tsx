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
  ANY_FLAVOR,
  GENRE_DEFINITIONS,
  NAME_GENERATOR_PATH,
  buildNameGeneratorHref,
  createRandomSeed,
  generateNames,
  nextSeed,
  parseNameGeneratorParams,
  type SearchParamsRecord,
} from "@/lib/tools/name-generator";
import { FAQS, INTRO, OG_TITLE, PAGE_DESCRIPTION, PAGE_HEADING, PAGE_TITLE } from "./content";
import { NameResults } from "./NameResults";

export const metadata = toolMetadata({
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  ogTitle: OG_TITLE,
  keywords: [
    "free character name generator",
    "character name generator",
    "fantasy name generator",
    "sci-fi name generator",
  ],
  path: NAME_GENERATOR_PATH,
});

const GENDER_OPTIONS = [
  { value: "any", label: "Any" },
  { value: "feminine", label: "Feminine" },
  { value: "masculine", label: "Masculine" },
  { value: "neutral", label: "Gender-neutral" },
] as const;

const TYPE_OPTIONS = [
  { value: "full", label: "Full name" },
  { value: "first", label: "First name only" },
  { value: "last", label: "Last name only" },
] as const;

/** Public character name generator; no auth. Names are SSR-rendered from the query string. */
export default async function CharacterNameGeneratorPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsRecord>;
} = {}) {
  const params = parseNameGeneratorParams(searchParams ? await searchParams : undefined);
  const seed = params.seed ?? createRandomSeed();
  const names = generateNames({ ...params, seed }).map((entry) => entry.name);
  const shareHref = buildNameGeneratorHref(seed, params);
  const freshSeed = nextSeed(seed);
  const moreHref = buildNameGeneratorHref(freshSeed, params);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <ToolHeader heading={PAGE_HEADING} intro={INTRO} />

      <form
        key={shareHref}
        method="get"
        action={NAME_GENERATOR_PATH}
        className="grid gap-4 sm:grid-cols-2"
        aria-label="Name filters"
      >
        {/* A new seed per submit keeps the resulting URL shareable. */}
        <input type="hidden" name="seed" value={freshSeed} />
        <SelectField id="ng-genre" name="genre" label="Genre" value={params.genre}>
          {renderOptions(
            GENRE_DEFINITIONS.map((genre) => ({ value: genre.id, label: genre.label })),
          )}
        </SelectField>
        <SelectField id="ng-gender" name="gender" label="Gender presentation" value={params.gender}>
          {renderOptions(GENDER_OPTIONS)}
        </SelectField>
        <SelectField
          id="ng-flavor"
          name="flavor"
          label="Culture or era flavor"
          value={params.flavor}
          hint="A flavor from another genre falls back to Any."
        >
          <option value={ANY_FLAVOR}>Any (mix the genre)</option>
          {GENRE_DEFINITIONS.map((genre) => (
            <optgroup key={genre.id} label={genre.label}>
              {renderOptions(
                genre.flavors.map((flavor) => ({ value: flavor.id, label: flavor.label })),
              )}
            </optgroup>
          ))}
        </SelectField>
        <SelectField id="ng-type" name="type" label="Name type" value={params.type}>
          {renderOptions(TYPE_OPTIONS)}
        </SelectField>
        <SubmitRow label="Generate names" />
      </form>

      <NameResults names={names} shareHref={shareHref} moreHref={moreHref} />

      <FaqSection heading="Character name generator FAQ" faqs={FAQS} />

      <MoreToolsSection>
        Need a plot to go with the name? Try the{" "}
        <ToolLink href="/tools/story-trope-generator">story trope generator</ToolLink>.
      </MoreToolsSection>

      <WaitlistCta
        title="Keep your cast in one place"
        body="syncodex is a writing workspace for novelists, with a story bible for your characters, places and lore, and a scene editor with an AI assistant that reads it."
        source="character-name-generator"
      />
    </main>
  );
}
