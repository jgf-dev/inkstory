import { PREFERENCES_BOOTSTRAP_SCRIPT } from "@/lib/ui/preferences";
import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "InkStory",
  description: "A novel-writing and world-building platform with an AI-aware Codex.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies stored theme/prose-font before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: PREFERENCES_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <Script
          id="betterstack-init"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              !function(b,e,t,r){
                b[t]=b[t]||function(...args){(b[t].q=b[t].q||[]).push(args)};
                b[t].l=+new Date;
                var s=e.createElement('script'); s.async=1; s.crossOrigin='anonymous';
                s.src='https://betterstack.net/b.js?t='+r;
                (e.head||e.getElementsByTagName('head')[0]).appendChild(s);
              }(window,document,'betterstack','TKXW6BinG9JpyjaRroQaZvnM');
              betterstack('init', { environment: 'production' });
            `,
          }}
        />
        {children}
      </body>
    </html>
  );
}
