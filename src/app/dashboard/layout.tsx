import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo/site";

export const metadata: Metadata = {
  robots: NOINDEX_ROBOTS,
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
