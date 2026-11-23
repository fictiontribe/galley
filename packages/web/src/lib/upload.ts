/**
 * Uploads that report progress. The fetch API can't say how much of a
 * request body has gone, so this one call uses XMLHttpRequest; errors and
 * the lost-session hand-off are the same as `api()`.
 */
import type { RouteResponse } from "@galley/core/api";
import { ApiFailure, failureFrom, requestOf, type ApiOptions, type JsonRoute } from "./api";

/** Call a JSON route; `onProgress` gets 0–1 as the body goes, or null when the browser can't measure. */
export function apiWithProgress<K extends JsonRoute>(route: K, options: ApiOptions<K>, onProgress: (fraction: number | null) => void): Promise<RouteResponse<K>> {
  const { method, url } = requestOf(route, options);
  const { body, signal } = options as { body?: unknown; signal?: AbortSignal };
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader("content-type", "application/json");
    xhr.setRequestHeader("accept", "application/json");
    xhr.upload.onprogress = (event) => onProgress(event.lengthComputable && event.total > 0 ? event.loaded / event.total : null);
    xhr.onerror = () =>
      reject(new ApiFailure(route, 0, { code: "internal", message: "Can’t reach the app’s server. Check that it’s still running, then try again.", detail: `${route} → network error` }));
    xhr.onabort = () => reject(new DOMException("The upload was stopped.", "AbortError"));
    xhr.onload = () => {
      const response = new Response(xhr.status === 204 ? null : xhr.responseText, { status: xhr.status, statusText: xhr.statusText });
      if (!response.ok) {
        void failureFrom(route, response).then(reject);
        return;
      }
      if (response.status === 204) {
        resolve(undefined as unknown as RouteResponse<K>);
        return;
      }
      response.json().then((json) => resolve(json as RouteResponse<K>), reject);
    };
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(JSON.stringify(body ?? {}));
  });
}
