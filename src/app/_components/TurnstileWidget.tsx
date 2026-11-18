"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { TurnstileAction } from "@/lib/turnstile";

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__inkstoryTurnstileOnLoad";

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  theme?: "light" | "dark" | "auto";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __inkstoryTurnstileOnLoad?: () => void;
  }
}

export interface TurnstileWidgetHandle {
  reset: () => void;
}

let turnstileLoadPromise: Promise<TurnstileApi | null> | null = null;

function ensureTurnstileLoaded(): Promise<TurnstileApi | null> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(null);
  }
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }
  if (turnstileLoadPromise) {
    return turnstileLoadPromise;
  }

  turnstileLoadPromise = new Promise<TurnstileApi | null>((resolve) => {
    const finish = () => {
      resolve(window.turnstile ?? null);
    };

    window.__inkstoryTurnstileOnLoad = finish;

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
    );
    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener(
        "error",
        () => {
          turnstileLoadPromise = null;
          resolve(null);
        },
        { once: true },
      );
      if (window.turnstile) {
        finish();
      }
      return;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener(
      "error",
      () => {
        turnstileLoadPromise = null;
        resolve(null);
      },
      { once: true },
    );
    document.head.appendChild(script);
  });

  return turnstileLoadPromise;
}

function resolveWidgetTheme(): "light" | "dark" {
  if (typeof document === "undefined") {
    return "light";
  }
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

interface TurnstileWidgetProps {
  siteKey: string;
  action: TurnstileAction;
  onTokenChange: (token: string) => void;
  ref?: Ref<TurnstileWidgetHandle>;
}

/**
 * Explicit Turnstile widget wrapper that retains its own widget ID and resets
 * single-use tokens across submission retries and client-side route transitions.
 */
export function TurnstileWidget({ siteKey, action, onTokenChange, ref }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenChangeRef = useRef(onTokenChange);
  onTokenChangeRef.current = onTokenChange;

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        onTokenChangeRef.current("");
        if (widgetIdRef.current !== null && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      },
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    void ensureTurnstileLoaded().then((api) => {
      if (cancelled || !api || !containerRef.current) {
        return;
      }

      if (widgetIdRef.current !== null) {
        try {
          api.remove(widgetIdRef.current);
        } catch {
          // Ignore if already removed
        }
        widgetIdRef.current = null;
      }

      const id = api.render(containerRef.current, {
        sitekey: siteKey,
        action,
        theme: resolveWidgetTheme(),
        callback: (token) => {
          onTokenChangeRef.current(token);
        },
        "expired-callback": () => {
          onTokenChangeRef.current("");
        },
        "error-callback": () => {
          onTokenChangeRef.current("");
        },
      });
      widgetIdRef.current = id;
    });

    return () => {
      cancelled = true;
      onTokenChangeRef.current("");
      if (widgetIdRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Ignore if container already detached
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, action]);

  return <div ref={containerRef} data-testid={`turnstile-${action}`} className="min-h-[65px]" />;
}
