"use client";

/** Small JSON fetch helpers shared by the writing-surface components. */

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
    public readonly body: unknown = null,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(url: string, method: string, body?: unknown): Promise<T> {
  let response: Response;
  // FormData is sent as-is so the browser sets the multipart boundary.
  const init: RequestInit =
    body === undefined || body instanceof FormData
      ? { method, body }
      : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  try {
    response = await fetch(url, init);
  } catch (err) {
    throw new ApiRequestError(
      `Network error: ${err instanceof Error ? err.message : "request failed"}`,
      0,
      null,
    );
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    const record = (payload ?? {}) as { error?: unknown; code?: unknown };
    throw new ApiRequestError(
      typeof record.error === "string" ? record.error : `Request failed (${response.status})`,
      response.status,
      typeof record.code === "string" ? record.code : null,
      payload,
    );
  }

  return payload as T;
}

export function apiGet<T>(url: string): Promise<T> {
  return request<T>(url, "GET");
}

export function apiPost<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, "POST", body);
}

/** POSTs multipart/form-data (file uploads). */
export function apiPostForm<T>(url: string, form: FormData): Promise<T> {
  return request<T>(url, "POST", form);
}

export function apiPatch<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, "PATCH", body);
}

export function apiDelete<T>(url: string): Promise<T> {
  return request<T>(url, "DELETE");
}
