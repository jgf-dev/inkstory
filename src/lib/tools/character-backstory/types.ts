import type { ConcreteGender, FlavorId, Genre } from "@/lib/tools/name-generator/types";

/** Validated request for one character backstory. */
export interface BackstoryInput {
  name: string;
  genre: Genre;
  /** A flavor of `genre`, or `any`. */
  flavor: FlavorId;
  gender: ConcreteGender;
}

/** `ai` when the model answered with a valid backstory, otherwise `template`. */
export type BackstorySource = "ai" | "template";

export interface BackstoryResult {
  backstory: string;
  source: BackstorySource;
}
