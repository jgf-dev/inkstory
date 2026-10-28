/**
 * JGF-128 visual-truth capture: renders the progressive-disclosure operating
 * modes (Writer / Stage / Architect), the Relation Linker, the Progression
 * Timeline and the Token Budget Bar at desktop 1440×900 and mobile 390×844,
 * in both the light "Parchment Desk" and dark "Obsidian Desk" themes, and
 * verifies text/non-text contrast ratios of the theme tokens.
 *
 * Usage: node scripts/visual-truth-jgf128.mjs
 * Requires the seeded dev database (.tmp/test-postgres on :54329).
 * Output: docs/design/jgf-128-modes/
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve(process.cwd(), "docs/design/jgf-128-modes");
await mkdir(OUT_DIR, { recursive: true });

const SEED_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "seed@inkstory.local",
  name: "Seed User",
  user_metadata: { name: "Seed User" },
};
const NOVEL_URL = "http://localhost:3000/dashboard/novels/seed-novel-1";

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function relativeLuminance(r, g, b) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(...rgb1);
  const l2 = relativeLuminance(...rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
function oklchToSrgbBytes(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const toByte = (c) => {
    const g = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, g)) * 255);
  };
  return [
    toByte(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toByte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function parseRgb(str) {
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  const oklch = str.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
  if (oklch) return oklchToSrgbBytes(+oklch[1], +oklch[2], +oklch[3]);
  const hex = str.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return [0, 0, 0];
}

async function startDevServer() {
  try {
    const res = await fetch("http://localhost:3000/api/health");
    if (res.ok) {
      console.log("Dev server already active on port 3000.");
      return null;
    }
  } catch {}
  console.log("Starting Next.js dev server on port 3000 (webpack mode)...");
  const devProc = spawn("node", ["./node_modules/.bin/next", "dev", "--webpack", "-p", "3000"], {
    env: { ...process.env, NEXT_PUBLIC_E2E: "true", PORT: "3000" },
    stdio: "inherit",
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch("http://localhost:3000/api/health");
      if (res.ok) {
        console.log("Dev server ready!");
        return devProc;
      }
    } catch {}
  }
  throw new Error("Dev server failed to start");
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
const MODES = ["writer", "stage", "architect"];
const THEMES = ["light", "dark"];

async function loadWorkspace(page) {
  // Retry once: the dev server occasionally aborts a cold compile mid-stream.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(NOVEL_URL, { waitUntil: "domcontentloaded" });
    try {
      await page.locator("[data-testid='writing-workspace']").waitFor({ state: "visible" });
      await page.locator("[data-testid='scene-editor']").waitFor({ state: "visible" });
      // Let the debounced mention scan + budget estimate settle.
      await page.waitForTimeout(2500);
      return;
    } catch (err) {
      if (attempt === 1) throw err;
      console.log("  retrying workspace load after cold-compile flake…");
    }
  }
}

async function newWorkspacePage(browser, viewport, { theme, mode }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  await context.addCookies([
    {
      name: "e2e-user",
      value: encodeURIComponent(JSON.stringify(SEED_USER)),
      domain: "localhost",
      path: "/",
      httpOnly: false,
      sameSite: "Lax",
    },
  ]);
  await context.addInitScript(
    ([t, m]) => {
      localStorage.setItem("inkstory.theme", t);
      localStorage.setItem("inkstory.mode", m);
    },
    [theme, mode],
  );
  const page = await context.newPage();
  await loadWorkspace(page);
  return { context, page };
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  saved ${name}.png`);
  return file;
}

async function measureThemeContrast(page) {
  return page.evaluate(() => {
    // Canvas normalizes oklch()/color() strings to #rrggbb for the ratio math.
    const ctx = document.createElement("canvas").getContext("2d");
    const norm = (css) => {
      ctx.fillStyle = css;
      return ctx.fillStyle;
    };
    const probe = (fgSel, bgSel) => {
      const fg = document.querySelector(fgSel);
      const bg = document.querySelector(bgSel);
      if (!fg || !bg) return null;
      return {
        color: norm(window.getComputedStyle(fg).color),
        background: norm(window.getComputedStyle(bg).backgroundColor),
      };
    };
    return {
      primaryOnApp: probe(
        "[data-testid='writing-workspace'] h1",
        "[data-testid='writing-workspace']",
      ),
      mutedOnCard:
        probe(
          "[data-testid='token-budget-summary']",
          "[data-testid='architect-rail-aside'] footer",
        ) ??
        probe(
          "[data-testid='writing-workspace'] header .text-muted",
          "[data-testid='writing-workspace'] header",
        ),
      segmentButtons: (() => {
        const seg = document.querySelector("[data-testid='budget-segment-seed']");
        const bar = seg?.closest("[role='group']");
        if (!seg || !bar) return null;
        return {
          segment: norm(window.getComputedStyle(seg).backgroundColor),
          track: norm(window.getComputedStyle(bar).backgroundColor),
        };
      })(),
    };
  });
}

async function main() {
  const serverProc = await startDevServer();
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const report = { timestamp: new Date().toISOString(), screenshots: [], contrast: {} };

  try {
    // ── 1. Mode × theme × viewport matrix ─────────────────────────────────
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        for (const mode of MODES) {
          const { context, page } = await newWorkspacePage(browser, vp, { theme, mode });
          const name = `${mode}-mode-${theme}-${vp.name}`;
          await shot(page, name);
          report.screenshots.push(name);

          if (vp.name === "desktop") {
            const contrast = await measureThemeContrast(page);
            report.contrast[`${mode}-${theme}`] = contrast;
            if (contrast?.primaryOnApp) {
              const ratio = contrastRatio(
                parseRgb(contrast.primaryOnApp.color),
                parseRgb(contrast.primaryOnApp.background),
              );
              console.log(`  contrast primary/app (${theme}): ${ratio.toFixed(2)}:1`);
            }
          }
          await context.close();
        }
      }
    }

    // ── 2. Relation Linker modal (desktop, both themes) ───────────────────
    for (const theme of THEMES) {
      const { context, page } = await newWorkspacePage(browser, VIEWPORTS[0], {
        theme,
        mode: "architect",
      });
      await page.selectOption("[data-testid='linker-source-select']", {
        label: "Mara Vance (CHARACTER)",
      });
      await page.getByRole("button", { name: "Open Relation Linker" }).click();
      await page.locator("[data-testid='relation-linker-modal']").waitFor({ state: "visible" });
      // Open the target combobox to show instant search.
      await page.locator("[data-testid='relation-target']").fill("qu");
      await page.waitForTimeout(300);
      const name = `relation-linker-${theme}-desktop`;
      await shot(page, name);
      report.screenshots.push(name);
      await context.close();
    }

    // ── 3. Progression Timeline drawer (desktop, both themes) ─────────────
    for (const theme of THEMES) {
      const { context, page } = await newWorkspacePage(browser, VIEWPORTS[0], {
        theme,
        mode: "architect",
      });
      await page.getByRole("button", { name: "Open Timeline" }).click();
      await page.locator("[data-testid='progression-timeline-drawer']").waitFor({
        state: "visible",
      });
      await page.waitForTimeout(1500);
      const name = `progression-timeline-${theme}-desktop`;
      await shot(page, name);
      report.screenshots.push(name);
      await context.close();
    }

    // ── 4. Timeline empty state (transport stubbed to an empty codex) ─────
    {
      const { context, page } = await newWorkspacePage(browser, VIEWPORTS[0], {
        theme: "light",
        mode: "architect",
      });
      await context.route("**/api/codex/entries?**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: '{"entries":[]}' }),
      );
      await page.getByRole("button", { name: "Open Timeline" }).click();
      await page.locator("[data-testid='progression-timeline-drawer']").waitFor({
        state: "visible",
      });
      await page
        .getByText("No progressions yet — add one from a Codex entry.")
        .waitFor({ state: "visible" });
      await shot(page, "progression-timeline-empty-light-desktop");
      report.screenshots.push("progression-timeline-empty-light-desktop");
      await context.close();
    }

    // ── 5. Token Budget Bar error state (transport stubbed to 500) ────────
    {
      const { context, page } = await newWorkspacePage(browser, VIEWPORTS[0], {
        theme: "light",
        mode: "architect",
      });
      await context.route("**/api/codex/entries?**", (route) =>
        route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }),
      );
      await page.reload({ waitUntil: "networkidle" });
      await page.locator("[data-testid='writing-workspace']").waitFor({ state: "visible" });
      await page.getByText("Couldn't estimate the context budget.").waitFor({ state: "visible" });
      await shot(page, "token-budget-error-light-desktop");
      report.screenshots.push("token-budget-error-light-desktop");
      await context.close();
    }

    // ── 6. Token Budget Bar over-budget state (real oversized ALWAYS entry)
    {
      const { context, page } = await newWorkspacePage(browser, VIEWPORTS[0], {
        theme: "light",
        mode: "architect",
      });
      const hugeDescription =
        "The Sunken Archives hold the tide-locked records of the old city. ".repeat(450); // ~27k chars ≈ 6.7k estimated tokens
      const created = await page.evaluate(async (description) => {
        const res = await fetch("/api/codex/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Lore Compendium (overflow probe)",
            type: "LORE",
            trackingMode: "ALWAYS",
            description,
            novelId: "seed-novel-1",
          }),
        });
        return res.json();
      }, hugeDescription);
      const createdId = created?.entry?.id;
      await page.reload({ waitUntil: "networkidle" });
      await page.locator("[data-testid='scene-editor']").waitFor({ state: "visible" });
      await page.getByTestId("budget-over-label").waitFor({ state: "visible", timeout: 15000 });
      await shot(page, "token-budget-over-budget-light-desktop");
      report.screenshots.push("token-budget-over-budget-light-desktop");
      if (createdId) {
        await page.evaluate(async (id) => {
          await fetch(`/api/codex/entries/${id}`, { method: "DELETE" });
        }, createdId);
      }
      await context.close();
    }

    // ── 7. Prose font toggle: same scene in Modern Sans (scope item 6) ────
    {
      const { context, page } = await newWorkspacePage(browser, VIEWPORTS[0], {
        theme: "light",
        mode: "writer",
      });
      await context.addInitScript(() => localStorage.setItem("inkstory.prose-font", "sans"));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("[data-testid='scene-editor']").waitFor({ state: "visible" });
      await page.waitForTimeout(1500);
      await shot(page, "writer-mode-sans-prose-light-desktop");
      report.screenshots.push("writer-mode-sans-prose-light-desktop");
      await context.close();
    }

    await writeFile(
      path.join(OUT_DIR, "visual-truth-report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(`\nReport written to ${path.join(OUT_DIR, "visual-truth-report.json")}`);
  } finally {
    await browser.close();
    if (serverProc) serverProc.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
