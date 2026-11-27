/**
 * Content guards for the adult writing prompt catalog (STO-1315). Tests run
 * these over every fragment so the build fails if one slips through; any
 * later AI mode must apply the same checks to model input and output.
 */

/** Minors, school-age or age-ambiguous framing, and "young-looking" workarounds. */
export const MINOR_PATTERNS: readonly RegExp[] = [
  /\bminors?\b/i,
  /\bunder-?age\b/i,
  /\bteen/i,
  /\b(thir|four|fif|six|seven|eigh|nine)teen\b/i,
  /\b(?:1?[0-9])[-\s]?(?:years?\s+old|year-?olds?|yo|y\/o)\b/i,
  /\baged?\s+1?[0-9]\b/i,
  /\b(child|children|kid|kids|baby|babies|toddler|infant|juvenile|adolescent|preteen|tween|youth)\b/i,
  /\b(boy|boys|girl|girls|schoolgirl|schoolboy|lolita?|loli|shota)\b/i,
  /\b(school|schools|student|students|pupil|pupils|classmates?|freshman|sophomore|homework|prom|campus|dorm|college|academy)\b/i,
  /\b(young|younger|youthful|petite|tiny|little|innocent|barely|virgin|virginal|naive)\b/i,
  /\b(step-?(brother|sister|son|daughter|mom|mum|dad|father|mother|parent))\b/i,
  /\b(daughter|son|brother|sister|sibling|cousin|niece|nephew|ward|babysitter)\b/i,
  /\b(ageplay|age-play|ddlg|daddy|mommy)\b/i,
];

/** Non-consent and dubious-consent themes; kept out of the shipped catalog by default. */
export const NON_CONSENT_PATTERNS: readonly RegExp[] = [
  /\bnon-?con(sent|sensual)?\b/i,
  /\bdub-?con\b/i,
  /\bforced\b(?! proximity)/i,
  /\b(force|forces|forcing)\b/i,
  /\b(rape|raped|ravish|ravished|assault|molest)/i,
  /\b(drugged|drunk|intoxicated|unconscious|asleep|sleeping)\b/i,
  /\b(coerc|blackmail|kidnap|abduct|captive|captor|hostage|enslave|slave)/i,
  /\bagainst (his|her|their) will\b/i,
  /\b(unwilling|resist|resisting|struggles?|helpless|stalk)/i,
];

/** Graphic anatomy or act vocabulary: fragments stay suggestive and kink-neutral. */
export const EXPLICIT_PATTERNS: readonly RegExp[] = [
  /\b(cock|dick|pussy|cunt|clit|nipples?|genitals?|penis|vagina|orgasm|cum|fuck)/i,
  /\b(smut|porn|xxx|nsfw)\b/i,
];

export interface GuardViolation {
  rule: "minor" | "non-consent" | "explicit";
  pattern: string;
}

/** Returns every rule the text breaks; empty when it is clean. */
export function findViolations(text: string): GuardViolation[] {
  const check = (rule: GuardViolation["rule"], patterns: readonly RegExp[]) =>
    patterns
      .filter((pattern) => pattern.test(text))
      .map((pattern) => ({
        rule,
        pattern: pattern.source,
      }));
  return [
    ...check("minor", MINOR_PATTERNS),
    ...check("non-consent", NON_CONSENT_PATTERNS),
    ...check("explicit", EXPLICIT_PATTERNS),
  ];
}

const AGE_DECADE = /\b(twenties|thirties|forties|fifties|sixties|seventies)\b/gi;

/** Pairing fragments must state an adult age for both characters. */
export function statesTwoAdultAges(text: string): boolean {
  return (text.match(AGE_DECADE) ?? []).length >= 2;
}
