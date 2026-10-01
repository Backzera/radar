"use client";
import { useEffect, useRef, useState, useCallback } from "react";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = (await response.json()) as T & {
    error?: string;
    fields?: { path: string; message: string }[];
  };
  if (!response.ok)
    throw new ApiError(
      data.error ?? "Não foi possível concluir.",
      response.status,
      data.fields ?? [],
    );
  return data as T;
}
export function useResource<T>(path: string | null) {
  const [state, setState] = useState<{
      data: T | null;
      error: string;
      loading: boolean;
    }>({ data: null, error: "", loading: true }),
    [version, setVersion] = useState(0),
    latest = useRef(path);
  useEffect(() => {
    latest.current = path;
    const controller = new AbortController();
    if (path === null) {
      queueMicrotask(() => setState({ data: null, error: "", loading: false }));
      return () => controller.abort();
    }
    queueMicrotask(() => {
      if (!controller.signal.aborted)
        setState((previous) => ({ ...previous, error: "", loading: true }));
    });
    request<T>(path, undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ data, error: "", loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            data: null,
            error:
              error instanceof Error ? error.message : "Falha ao carregar.",
            loading: false,
          });
      });
    return () => controller.abort();
  }, [path, version]);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, refresh };
}
export const money = (value: number | null | undefined) =>
  value == null
    ? "Não informado"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(value);
export const when = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("pt-BR") : "Ainda não registrada";
export function safeListingUrl(value: string | undefined) {
  try {
    const u = new URL(value ?? "");
    return u.protocol === "https:" &&
      ["facebook.com", "www.facebook.com", "m.facebook.com"].includes(
        u.hostname,
      ) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir.";
}
