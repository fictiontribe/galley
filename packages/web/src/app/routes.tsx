import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { useHostedInstall } from "@/lib/stores/meta";
import { LoginScreen } from "@/screens/login/LoginScreen";
import { NotFoundScreen } from "@/screens/NotFoundScreen";
import { SitesScreen } from "@/screens/sites/SitesScreen";
import { HomeFrame, HostedHome, SiteFrame } from "./Frames";

// Route-level code splitting: everything below loads on first visit, so the
// editor's heavy pieces (CodeMirror, markdown) never weigh on the first paint.
const SiteHomeScreen = lazy(() => import("@/screens/site-home/SiteHomeScreen").then((m) => ({ default: m.SiteHomeScreen })));
const HistoryScreen = lazy(() => import("@/screens/history/HistoryScreen").then((m) => ({ default: m.HistoryScreen })));
const AppSettingsScreen = lazy(() => import("@/screens/settings/AppSettingsScreen").then((m) => ({ default: m.AppSettingsScreen })));
const SiteSettingsScreen = lazy(() => import("@/screens/site-settings/SiteSettingsScreen").then((m) => ({ default: m.SiteSettingsScreen })));
const CollectionScreen = lazy(() => import("@/features/content/CollectionScreen").then((m) => ({ default: m.CollectionScreen })));
const EditorScreen = lazy(() => import("@/features/editor/EditorScreen").then((m) => ({ default: m.EditorScreen })));
const ProofScreen = lazy(() => import("@/features/proof/ProofScreen").then((m) => ({ default: m.ProofScreen })));
const MediaScreen = lazy(() => import("@/features/media/MediaScreen").then((m) => ({ default: m.MediaScreen })));
const OpenScreen = lazy(() => import("@/screens/open/OpenScreen").then((m) => ({ default: m.OpenScreen })));
const FormsScreen = lazy(() => import("@/features/forms/FormsScreen").then((m) => ({ default: m.FormsScreen })));
const VisibilityScreen = lazy(() => import("@/features/seo/VisibilityScreen").then((m) => ({ default: m.VisibilityScreen })));
const ScriptsScreen = lazy(() => import("@/features/scripts/ScriptsScreen").then((m) => ({ default: m.ScriptsScreen })));
const BrandScreen = lazy(() => import("@/features/brand/BrandScreen").then((m) => ({ default: m.BrandScreen })));
const InboxScreen = lazy(() => import("@/features/inbox/InboxScreen").then((m) => ({ default: m.InboxScreen })));
const OnlineScreen = lazy(() => import("@/features/deploy/Online").then((m) => ({ default: m.OnlineScreen })));
const RedirectsScreen = lazy(() => import("@/features/redirects/RedirectsScreen").then((m) => ({ default: m.RedirectsScreen })));
const ImportScreen = lazy(() => import("@/features/import/ImportScreen").then((m) => ({ default: m.ImportScreen })));
const NewSiteScreen = lazy(() => import("@/features/wizard/NewSiteScreen").then((m) => ({ default: m.NewSiteScreen })));
const PluginsScreen = lazy(() => import("@/features/plugins/PluginsScreen").then((m) => ({ default: m.PluginsScreen })));
const SitePluginsScreen = lazy(() => import("@/features/plugins/PluginsScreen").then((m) => ({ default: m.SitePluginsScreen })));
const SetupScreen = lazy(() => import("@/features/install/setup/SetupScreen").then((m) => ({ default: m.SetupScreen })));
const InstallScreen = lazy(() => import("@/features/install/InstallScreen").then((m) => ({ default: m.InstallScreen })));

/**
 * A hosted install has one site: no Sites screen, no /new or /open (their
 * addresses fall through to "not found"), and two screens of its own —
 * first run at /setup and the Install page.
 */
export function AppRoutes() {
  const hosted = useHostedInstall();
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      {hosted ? (
        <Route path="/setup" element={<Suspense fallback={null}><SetupScreen /></Suspense>} />
      ) : (
        <Route path="/open" element={<Suspense fallback={null}><OpenScreen /></Suspense>} />
      )}
      <Route element={<HomeFrame />}>
        <Route index element={hosted ? <HostedHome /> : <SitesScreen />} />
        {hosted ? null : <Route path="new" element={<NewSiteScreen />} />}
        <Route path="settings" element={<AppSettingsScreen />} />
        <Route path="plugins" element={<PluginsScreen />} />
        {hosted ? <Route path="install" element={<InstallScreen />} /> : null}
        <Route path="*" element={<NotFoundScreen />} />
      </Route>
      <Route path="/sites/:siteId" element={<SiteFrame />}>
        <Route index element={<SiteHomeScreen />} />
        <Route path="c/:collectionId" element={<CollectionScreen />} />
        <Route path="edit" element={<EditorScreen />} />
        <Route path="proof" element={<ProofScreen />} />
        <Route path="media" element={<MediaScreen />} />
        <Route path="forms" element={<FormsScreen />} />
        <Route path="forms/:formId" element={<FormsScreen />} />
        <Route path="scripts" element={<ScriptsScreen />} />
        <Route path="brand" element={<BrandScreen />} />
        <Route path="visibility" element={<VisibilityScreen />} />
        <Route path="inbox" element={<InboxScreen />} />
        <Route path="history" element={<HistoryScreen />} />
        <Route path="online" element={<OnlineScreen />} />
        <Route path="redirects" element={<RedirectsScreen />} />
        <Route path="import" element={<ImportScreen />} />
        <Route path="settings" element={<SiteSettingsScreen />} />
        <Route path="plugins" element={<SitePluginsScreen />} />
        <Route path="*" element={<NotFoundScreen />} />
      </Route>
    </Routes>
  );
}
