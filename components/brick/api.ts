"use client";
import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

async function parse<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    fields?: { path: string; message: string }[];
  };
  if (response.status === 401 && !location.pathname.startsWith("/entrar")) {
    location.href = `/entrar?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (!response.ok)
    throw new ApiError(
      data.error ?? "Não foi possível concluir. Tente de novo.",
      response.status,
      data.fields ?? [],
    );
  return data;
}

/** JSON call to /api/v1. GET without body; POST/DELETE always send JSON. */
export async function api<T>(
  path: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  const response = await fetch(`/api/v1/${path}`, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(init.body ?? {}),
    signal: init.signal,
  });
  return parse<T>(response);
}

export async function uploadPhoto<T>(itemId: string, photo: Blob): Promise<T> {
  const response = await fetch(
    `/api/v1/inventory/${encodeURIComponent(itemId)}/photos`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": photo.type },
      body: photo,
    },
  );
  return parse<T>(response);
}

/** Loads a GET resource and reloads it whenever `refresh` is called. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({
    data: null,
    error: "",
    loading: !!path,
  });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) setState((s) => ({ ...s, loading: true, error: "" }));
    });
    api<T>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, error: "", loading: false });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState((s) => ({
            ...s,
            error: error instanceof Error ? error.message : "Falha ao carregar.",
            loading: false,
          }));
      });
    return () => controller.abort();
  }, [path, version]);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, refresh };
}

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Não foi possível concluir.";
export const fieldErrors = (error: unknown) =>
  error instanceof ApiError
    ? Object.fromEntries(error.fields.map((f) => [f.path, f.message]))
    : {};
