import { buildSitemap } from "@/lib/seo/site";

/** Served at `/sitemap.xml`. */
export default function sitemap() {
  return buildSitemap();
}
