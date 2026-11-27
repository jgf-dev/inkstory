/**
 * Shared server-rendered building blocks for the public /tools pages:
 * metadata, header, filter selects, FAQ (with FAQPage JSON-LD) and the
 * waitlist call to action.
 */
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";

export const SITE_ORIGIN = "https://syncodex.xyz";

export interface Faq {
  q: string;
  a: string;
}

export function toolMetadata(input: {
  title: string;
  description: string;
  ogTitle: string;
  keywords: string[];
  path: string;
}): Metadata {
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: input.title,
    description: input.description,
    keywords: input.keywords,
    alternates: { canonical: input.path },
    openGraph: {
      title: input.ogTitle,
      description: input.description,
      siteName: "syncodex",
      type: "website",
      url: input.path,
    },
    twitter: { card: "summary", title: input.ogTitle, description: input.description },
  };
}

export function ToolHeader({ heading, intro }: { heading: string; intro: string }) {
  return (
    <>
      <p className="text-ink-500 mb-2 text-sm font-medium tracking-wide">
        <Link href="/" className="hover:underline">
          syncodex
        </Link>{" "}
        · Writing tools
      </p>
      <h1 className="mb-3 text-3xl font-semibold">{heading}</h1>
      <p className="text-ink-600 mb-8">{intro}</p>
    </>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function renderOptions(options: readonly Option[]) {
  return options.map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ));
}

export function SelectField(props: {
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
        key={props.value}
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

export function SubmitRow({ label }: { label: string }) {
  return (
    <div className="col-span-full">
      <button
        type="submit"
        className="bg-ink-900 text-ink-50 rounded-md px-4 py-2 text-sm font-medium"
      >
        {label}
      </button>
    </div>
  );
}

export function faqJsonLd(faqs: readonly Faq[]): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  }).replace(/</g, "\\u003c");
}

export function FaqSection({ heading, faqs }: { heading: string; faqs: readonly Faq[] }) {
  return (
    <section aria-labelledby="faq-heading" className="mt-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd(faqs) }} />
      <h2 id="faq-heading" className="mb-4 text-xl font-semibold">
        {heading}
      </h2>
      <div className="space-y-3">
        {faqs.map((faq) => (
          <details key={faq.q} className="border-ink-200 bg-card rounded-lg border p-4 shadow-xs">
            <summary className="text-ink-900 cursor-pointer font-medium">{faq.q}</summary>
            <p className="text-ink-600 mt-2 text-sm">{faq.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function MoreToolsSection({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="more-tools-heading" className="mt-12">
      <h2 id="more-tools-heading" className="mb-2 text-xl font-semibold">
        More writing tools
      </h2>
      <p className="text-ink-600">{children}</p>
    </section>
  );
}

export function ToolLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-ink-900 font-medium underline">
      {children}
    </Link>
  );
}

export function WaitlistCta(props: { title: string; body: string; source: string }) {
  return (
    <section className="border-ink-200 bg-card mt-12 rounded-lg border p-6">
      <h2 className="mb-2 text-xl font-semibold">{props.title}</h2>
      <p className="text-ink-600 mb-4">{props.body}</p>
      <Link
        href={`/waitlist?source=${encodeURIComponent(props.source)}`}
        className="bg-ink-900 text-ink-50 inline-block rounded-md px-4 py-2 text-sm font-medium"
      >
        Join the waitlist
      </Link>
    </section>
  );
}
