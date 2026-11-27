import type { Metadata } from "next";
import Link from "next/link";
import {
  ANY_FLAVOR,
  GENRE_DEFINITIONS,
  NAME_GENERATOR_PATH,
  NAME_GENERATOR_URL,
  buildNameGeneratorHref,
  createRandomSeed,
  generateNames,
  nextSeed,
  parseNameGeneratorParams,
  type SearchParamsRecord,
} from "@/lib/tools/name-generator";
import { FAQS, INTRO, OG_TITLE, PAGE_DESCRIPTION, PAGE_HEADING, PAGE_TITLE } from "./content";
import { NameResults, type BackstoryContext } from "./NameResults";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    "free character name generator",
    "character name generator",
    "fantasy name generator",
    "sci-fi name generator",
  ],
  alternates: { canonical: NAME_GENERATOR_URL },
  openGraph: {
    title: OG_TITLE,
    description: PAGE_DESCRIPTION,
    siteName: "syncodex",
    type: "website",
    url: NAME_GENERATOR_URL,
  },
  twitter: {
    card: "summary",
    title: OG_TITLE,
    description: PAGE_DESCRIPTION,
  },
};

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

const FAQ_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((faq) => ({
    "@type": "Question",
    name: faq.q,
    acceptedAnswer: { "@type": "Answer", text: faq.a },
  })),
}).replace(/</g, "\\u003c");

interface Option {
  value: string;
  label: string;
}

function renderOptions(options: readonly Option[]) {
  return options.map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ));
}

function SelectField(props: {
  id: string;
  name: string;
  label: string;
  value: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={props.id} className="text-ink-700 mb-1 block text-sm font-medium">
        {props.label}
      </label>
      <select
        id={props.id}
        name={props.name}
        defaultValue={props.value}
        className="border-ink-200 bg-card w-full rounded-md border px-2 py-2 text-sm"
      >
        {props.children}
      </select>
      {props.hint ? <p className="text-ink-500 mt-1 text-xs">{props.hint}</p> : null}
    </div>
  );
}

/** Public character name generator; no auth. Names are SSR-rendered from the query string. */
export default async function CharacterNameGeneratorPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsRecord>;
} = {}) {
  const params = parseNameGeneratorParams(searchParams ? await searchParams : undefined);
  const seed = params.seed ?? createRandomSeed();
  const entries = generateNames({ ...params, seed });
  const names = entries.map((entry) => entry.name);
  const backstory: BackstoryContext = {
    genre: params.genre,
    flavor: params.flavor,
    genders: Object.fromEntries(entries.map((entry) => [entry.name, entry.gender])),
  };
  const shareHref = buildNameGeneratorHref(seed, params);
  const freshSeed = nextSeed(seed);
  const moreHref = buildNameGeneratorHref(freshSeed, params);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }} />
      <p className="text-ink-500 mb-2 text-sm font-medium tracking-wide">
        <Link href="/" className="hover:underline">
          syncodex
        </Link>{" "}
        · Writing tools
      </p>
      <h1 className="mb-3 text-3xl font-semibold">{PAGE_HEADING}</h1>
      <p className="text-ink-600 mb-8">{INTRO}</p>

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
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="bg-ink-900 text-ink-50 rounded-md px-4 py-2 text-sm font-medium"
          >
            Generate names
          </button>
        </div>
      </form>

      <NameResults names={names} shareHref={shareHref} moreHref={moreHref} backstory={backstory} />

      <section aria-labelledby="faq-heading" className="mt-12">
        <h2 id="faq-heading" className="mb-4 text-xl font-semibold">
          Character name generator FAQ
        </h2>
        <div className="space-y-3">
          {FAQS.map((faq) => (
            <details key={faq.q} className="border-ink-200 bg-card rounded-lg border p-4 shadow-xs">
              <summary className="text-ink-900 cursor-pointer font-medium">{faq.q}</summary>
              <p className="text-ink-600 mt-2 text-sm">{faq.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section aria-labelledby="more-tools-heading" className="mt-12">
        <h2 id="more-tools-heading" className="mb-2 text-xl font-semibold">
          More writing tools
        </h2>
        <p className="text-ink-600">
          Need a plot to go with the name? Try the{" "}
          <Link href="/tools/story-trope-generator" className="text-ink-900 font-medium underline">
            story trope generator
          </Link>
          .
        </p>
      </section>

      <section className="border-ink-200 bg-card mt-12 rounded-lg border p-6">
        <h2 className="mb-2 text-xl font-semibold">Keep your cast in one place</h2>
        <p className="text-ink-600 mb-4">
          syncodex is a writing workspace for novelists, with a story bible for your characters,
          places and lore, and a scene editor with an AI assistant that reads it.
        </p>
        <Link
          href="/waitlist?source=character-name-generator"
          className="bg-ink-900 text-ink-50 inline-block rounded-md px-4 py-2 text-sm font-medium"
        >
          Join the waitlist
        </Link>
      </section>
    </main>
  );
}
