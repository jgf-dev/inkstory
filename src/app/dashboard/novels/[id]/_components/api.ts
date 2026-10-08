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
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
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

export function apiPatch<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, "PATCH", body);
}

export function apiDelete<T>(url: string): Promise<T> {
  return request<T>(url, "DELETE");
}
