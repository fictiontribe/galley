/**
 * Which video service (and model) to use when more than one is set up. Kept
 * in the app's settings (`Settings.videos`), so the choice follows the
 * person to another browser and the server uses it for requests that don't
 * name a service. Without a choice the first service set up is used.
 */
import { useCallback, useEffect } from "react";
import type { Settings, VideoProviderInfo } from "@galley/core/types";
import { api } from "@/lib/api";
import { setQueryData, useQuery } from "@/lib/query";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";

/** Where an earlier version kept the choice in this browser; moved into settings once, then removed. */
const OLD_KEY = "galley.video-prefs";

interface VideoPrefs {
  provider: string | null;
  model: string | null;
  /** Settings have been read (or couldn't be): the choice above is the real one. */
  ready: boolean;
  /** Save the choice in settings. */
  choose: (provider: string | null, model?: string | null) => void;
}

function oldChoice(): { provider: string | null; model: string | null } | null {
  try {
    const raw = globalThis.localStorage?.getItem(OLD_KEY);
    const parsed = raw ? (JSON.parse(raw) as { state?: { provider?: string | null; model?: string | null } }) : null;
    return parsed?.state?.provider ? { provider: parsed.state.provider, model: parsed.state.model ?? null } : null;
  } catch {
    return null;
  }
}

async function save(provider: string | null, model: string | null): Promise<Settings> {
  const settings = await api("PATCH /api/settings", { body: { videos: { provider, model } } });
  setQueryData(keys.settings(), settings);
  return settings;
}

export function useVideoPrefs(): VideoPrefs {
  const settings = useQuery(keys.settings(), () => api("GET /api/settings"));
  const videos = settings.data?.videos;
  const choose = useCallback((provider: string | null, model: string | null = null) => {
    save(provider, model).catch((error: unknown) => notify({ tone: "danger", title: "Couldn’t save the video service", body: error instanceof Error ? error.message : undefined }));
  }, []);

  // A choice made before settings had a place for it moves there once.
  useEffect(() => {
    if (!settings.data || !videos || videos.provider) return;
    const old = oldChoice();
    globalThis.localStorage?.removeItem(OLD_KEY);
    if (old) save(old.provider, old.model).catch(() => undefined);
  }, [settings.data, videos]);

  return { provider: videos?.provider ?? null, model: videos?.model ?? null, ready: settings.data !== undefined || settings.status === "error", choose };
}

/** The provider to start the dialog with: the chosen one if it's still there, else the first set up, else the first. */
export function preferredProvider(providers: readonly VideoProviderInfo[], chosen: string | null): VideoProviderInfo | undefined {
  return providers.find((provider) => provider.id === chosen) ?? providers.find((provider) => provider.configured) ?? providers[0];
}
