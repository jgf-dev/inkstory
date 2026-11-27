import { buildRobots } from "@/lib/seo/site";

/** Served at `/robots.txt`. */
export default function robots() {
  return buildRobots();
}
