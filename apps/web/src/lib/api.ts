import type { ApiErrorBody, ApiErrorCode } from "@asaa/contracts";

/** Normalised API failure used by every screen for consistent error states. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | "NETWORK",
    message: string,
    readonly fields: Record<string, string> = {},
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Listener = () => void;
const unauthenticatedListeners = new Set<Listener>();
/** Notified when any call returns 401 so the app can return to sign-in. */
export function onUnauthenticated(listener: Listener): () => void {
  unauthenticatedListeners.add(listener);
  return () => unauthenticatedListeners.delete(listener);
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = init.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      signal: init.signal,
      headers: {
        accept: "application/json",
        // CSRF header required by the API for every state-changing request.
        ...(method !== "GET" ? { "x-requested-with": "asaa-templates" } : {}),
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK", "Cannot reach the server. Check that the API is running.");
  }
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!response.ok) {
    const error = payload?.error;
    if (response.status === 401 && !path.startsWith("/auth/login")) {
      for (const listener of unauthenticatedListeners) listener();
    }
    throw new ApiError(
      response.status,
      error?.code ?? "INTERNAL",
      error?.message ?? `Request failed (${response.status}).`,
      error?.fields ?? {},
      error?.requestId,
    );
  }
  return payload as T;
}

/** POST a JSON body and save the binary response (for example a ZIP export) through the browser. */
export async function apiDownload(path: string, body: unknown): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-requested-with": "asaa-templates", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Cannot reach the server. Check that the API is running.");
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    throw new ApiError(
      response.status,
      payload?.error?.code ?? "INTERNAL",
      payload?.error?.message ?? `Request failed (${response.status}).`,
      payload?.error?.fields ?? {},
      payload?.error?.requestId,
    );
  }
  const filename = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "export.zip";
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return filename;
}
