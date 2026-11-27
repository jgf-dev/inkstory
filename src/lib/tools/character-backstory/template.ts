/**
 * Algorithmic backstory used whenever AI mode is unavailable, rate limited or
 * fails. Pure and deterministic: the same name and filters always produce the
 * same paragraph, on the server and in the browser.
 */
import { createRng, randomInt, type Rng } from "../name-generator/rng";
import type { Genre } from "../name-generator/types";
import type { BackstoryInput } from "./types";

interface GenreFragments {
  origins: readonly string[];
  turns: readonly string[];
  wants: readonly string[];
}

const FRAGMENTS: Readonly<Record<Genre, GenreFragments>> = {
  fantasy: {
    origins: [
      "grew up in a river town where every bridge was guarded by an old oath",
      "was raised by a hedge-witch who traded charms for bread",
      "was born the youngest child of a disgraced knightly house",
      "spent a childhood copying spells in a crumbling mountain library",
      "came of age among caravan traders crossing the salt wastes",
    ],
    turns: [
      "A broken promise to a dying mentor still keeps them awake at night.",
      "They once stole a relic they never meant to keep, and someone powerful noticed.",
      "A fire took their home, and they have never learned who set it.",
      "They carry a sealed letter they have sworn never to open.",
      "They walked away from a war that everyone else remembers as a victory.",
    ],
    wants: [
      "Now they want to return the relic before its curse finds the people they love.",
      "Now they want a place where nobody knows their family name.",
      "Now they want to prove the old oath can still be kept.",
      "Now they want answers, even if the truth costs them their place in the world.",
      "Now they want to earn back the trust they spent too freely.",
    ],
  },
  "sci-fi": {
    origins: [
      "grew up on a mining station where air was rationed by the hour",
      "was raised in the outer colonies on secondhand data and patched hulls",
      "was trained as a navigator before the academy closed its doors",
      "spent their youth repairing drones in a crowded orbital market",
      "came of age aboard a generation ship that had forgotten its destination",
    ],
    turns: [
      "A routine jump went wrong, and they are the only one who remembers it differently.",
      "They signed a contract they did not read, and the corporation still owns part of them.",
      "They found a signal in the static that no one else believes is real.",
      "They covered for a friend's mistake and lost their rank because of it.",
      "Their memories from one lost year were wiped, and someone paid for it.",
    ],
    wants: [
      "Now they want to buy back their freedom one risky job at a time.",
      "Now they want to trace the signal to its source.",
      "Now they want to find out who erased that year, and why.",
      "Now they want a crew they can trust with their life.",
      "Now they want to bring their people somewhere they can finally call home.",
    ],
  },
  modern: {
    origins: [
      "grew up above the family diner and learned to read people before menus",
      "was raised by a single parent who worked nights at the hospital",
      "spent their teens fixing cars in a small town everyone else left",
      "was the quiet kid who knew every shortcut through the city",
      "grew up between two languages and never felt fully at home in either",
    ],
    turns: [
      "A secret they kept for a friend has started to unravel their own life.",
      "They walked away from a career everyone said they were born for.",
      "They witnessed something years ago and never told anyone.",
      "An inheritance arrived with a stranger's name attached to it.",
      "They made one choice under pressure that they still replay every day.",
    ],
    wants: [
      "Now they want to make things right before someone else gets hurt.",
      "Now they want to start over without lying about where they came from.",
      "Now they want to know who the stranger was and what they owed them.",
      "Now they want one honest relationship that survives the truth.",
      "Now they want to stop running and finally face the people they left behind.",
    ],
  },
  historical: {
    origins: [
      "grew up in a port city where news arrived with every tide",
      "was raised in a printer's shop, ink on their hands before they could write",
      "was born on a farm that changed owners three times in one generation",
      "served in a great household and learned every secret its walls kept",
      "came of age apprenticed to a cartographer charting contested borders",
    ],
    turns: [
      "A pamphlet they helped print put a friend in prison.",
      "They hold a deed that would ruin a powerful family if it came to light.",
      "A sibling vanished at sea, and the official story does not add up.",
      "They took the blame for a theft to protect someone they loved.",
      "They kept a forbidden correspondence that someone has started reading.",
    ],
    wants: [
      "Now they want to free their friend without becoming a traitor themselves.",
      "Now they want to decide whether justice is worth the scandal.",
      "Now they want to find their sibling, or at least the truth.",
      "Now they want to clear their name before the next assize.",
      "Now they want to choose their own future instead of the one arranged for them.",
    ],
  },
};

function pick(rng: Rng, list: readonly string[]): string {
  return list[randomInt(rng, list.length)];
}

/** Deterministic three-sentence backstory for a generated name. */
export function templateBackstory(input: BackstoryInput): string {
  const fragments = FRAGMENTS[input.genre];
  const rng = createRng(`backstory:${input.genre}:${input.flavor}:${input.name.toLowerCase()}`);
  const origin = pick(rng, fragments.origins);
  const turn = pick(rng, fragments.turns);
  const want = pick(rng, fragments.wants);
  return `${input.name} ${origin}. ${turn} ${want}`;
}
