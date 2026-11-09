import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "./api";

export type Resource<T> =
  | { state: "loading"; data?: undefined; error?: undefined }
  | { state: "error"; data?: undefined; error: ApiError }
  | { state: "ready"; data: T; error?: undefined };

/** Fetch a resource with loading/error/ready states, aborting stale requests. */
export function useResource<T>(path: string | null): Resource<T> & { reload: () => void } {
  const [resource, setResource] = useState<Resource<T>>({ state: "loading" });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setResource((current) => (current.state === "ready" ? current : { state: "loading" }));
    api<T>(path, { signal: controller.signal })
      .then((data) => setResource({ state: "ready", data }))
      .catch((error: unknown) => {
        if ((error as Error).name === "AbortError") return;
        setResource({
          state: "error",
          error: error instanceof ApiError ? error : new ApiError(0, "INTERNAL", "Unexpected error."),
        });
      });
    return () => controller.abort();
  }, [path, tick]);

  return { ...resource, reload };
}

/** Submit helper: tracks pending state and field errors for forms. */
export function useMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const submit = useCallback(
    async (input: TInput): Promise<TResult | undefined> => {
      setPending(true);
      setError(null);
      try {
        return await run(input);
      } catch (caught) {
        const apiError = caught instanceof ApiError ? caught : new ApiError(0, "INTERNAL", "Unexpected error.");
        if (mounted.current) setError(apiError);
        return undefined;
      } finally {
        if (mounted.current) setPending(false);
      }
    },
    [run],
  );
  return { submit, pending, error, setError };
}
