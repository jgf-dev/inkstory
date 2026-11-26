// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import WaitlistPage, { metadata } from "../src/app/waitlist/page";
import { WaitlistForm } from "../src/app/waitlist/WaitlistForm";
import { WAITLIST_HONEYPOT_FIELD } from "../src/lib/waitlist/validation";

const originalFetch = globalThis.fetch;

function mockFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function submitEmail(email: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  const form = screen.getByRole("button", { name: "Join the waitlist" }).closest("form");
  if (!form) throw new Error("form not rendered");
  fireEvent.submit(form);
}

describe("waitlist page", () => {
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it("renders the syncodex description and form without dates, pricing or promises", async () => {
    const html = renderToStaticMarkup(
      await WaitlistPage({ searchParams: Promise.resolve({ source: "X" }) }),
    );
    expect(html).toContain("Join the waitlist");
    expect(html).toContain("syncodex is a writing workspace for novelists");
    const text = [html, JSON.stringify(metadata)].join(" ");
    expect(text).not.toMatch(/\$|price|pricing|free|launch|soon|20\d\d|guarantee|early access/i);
    expect(metadata.openGraph).toMatchObject({ siteName: "syncodex" });
  });

  it("renders without search params", async () => {
    const html = renderToStaticMarkup(await WaitlistPage());
    expect(html).toContain("waitlist-email");
  });

  it("posts the email, source and honeypot, then shows the success message", async () => {
    const fetchMock = mockFetch(async () =>
      Response.json({ ok: true, message: "Thanks! You're on the list." }),
    );
    render(<WaitlistForm source="x" />);
    submitEmail("writer@example.com");

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("on the list"));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/waitlist");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "writer@example.com",
      source: "x",
      [WAITLIST_HONEYPOT_FIELD]: "",
    });
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("");
  });

  it("falls back to a default success message when the body is empty", async () => {
    mockFetch(async () => new Response("", { status: 200 }));
    render(<WaitlistForm />);
    submitEmail("writer@example.com");
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("on the list"));
  });

  it("shows the server's validation error", async () => {
    mockFetch(async () =>
      Response.json({ error: "Please enter a valid email address." }, { status: 400 }),
    );
    render(<WaitlistForm />);
    submitEmail("nope");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Please enter a valid email address."),
    );
  });

  it("shows a generic error when the server sends no message", async () => {
    mockFetch(async () => new Response("oops", { status: 500 }));
    render(<WaitlistForm />);
    submitEmail("writer@example.com");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("try again"));
  });

  it("shows a network error when the request fails", async () => {
    mockFetch(async () => {
      throw new TypeError("offline");
    });
    render(<WaitlistForm />);
    submitEmail("writer@example.com");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Unable to reach the server"),
    );
  });

  it("includes document.referrer when present", async () => {
    const referrerDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "referrer");
    Object.defineProperty(document, "referrer", {
      configurable: true,
      get: () => "https://news.ycombinator.com/",
    });
    try {
      const fetchMock = mockFetch(async () =>
        Response.json({ ok: true, message: "Thanks! You're on the list." }),
      );
      render(<WaitlistForm />);
      submitEmail("writer@example.com");

      await waitFor(() => expect(screen.getByRole("status").textContent).toContain("on the list"));
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toMatchObject({
        email: "writer@example.com",
        referrer: "https://news.ycombinator.com/",
      });
    } finally {
      if (referrerDescriptor) {
        Object.defineProperty(document, "referrer", referrerDescriptor);
      } else {
        delete (document as unknown as Record<string, unknown>).referrer;
      }
    }
  });

  it("disables the button with a reason and ignores duplicate submits while submitting", async () => {
    let resolve: (r: Response) => void = () => {};
    const fetchMock = mockFetch(() => new Promise<Response>((r) => (resolve = r)));
    render(<WaitlistForm />);
    const honeypot = screen.getByLabelText("Website", { selector: "input" });
    expect(honeypot.getAttribute("autocomplete")).toBe("new-password");
    expect(honeypot.getAttribute("data-1p-ignore")).toBe("true");
    fireEvent.change(honeypot, {
      target: { value: "bot" },
    });
    submitEmail("writer@example.com");

    const button = await screen.findByRole("button", { name: "Joining…" });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("title")).toBe("Submitting your email…");

    const form = button.closest("form");
    if (!form) throw new Error("form not rendered");
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve(Response.json({ ok: true, message: "done" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("done"));
  });
});
