import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { LINK_PATHS } from "@galley/core/install/accounts";
import { useHostedInstall } from "@/lib/stores/meta";
import { Allowed } from "@/features/accounts/NotYours";
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
const AccountScreen = lazy(() => import("@/features/accounts/AccountScreen").then((m) => ({ default: m.AccountScreen })));
const LinkScreen = lazy(() => import("@/features/accounts/LinkScreen").then((m) => ({ default: m.LinkScreen })));

/**
 * A hosted install has one site: no Sites screen, no /new or /open (their
 * addresses fall through to "not found"), and screens of its own — first
 * run at /setup, the Install page, Your account, and the pages a one-time
 * link opens. With accounts, a screen whose reason to exist is a route the
 * signed-in person may not call shows "this isn't part of your account"
 * (`Allowed`); everywhere else every screen is there, as before.
 */
export function AppRoutes() {
  const hosted = useHostedInstall();
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      {hosted ? (
        <>
          <Route path="/setup" element={<Suspense fallback={null}><SetupScreen /></Suspense>} />
          <Route path={LINK_PATHS.invitation} element={<Suspense fallback={null}><LinkScreen /></Suspense>} />
          <Route path={LINK_PATHS.password} element={<Suspense fallback={null}><LinkScreen /></Suspense>} />
        </>
      ) : (
        <Route path="/open" element={<Suspense fallback={null}><OpenScreen /></Suspense>} />
      )}
      <Route element={<HomeFrame />}>
        <Route index element={hosted ? <HostedHome /> : <SitesScreen />} />
        {hosted ? null : <Route path="new" element={<NewSiteScreen />} />}
        <Route path="settings" element={<Allowed route="PATCH /api/settings"><AppSettingsScreen /></Allowed>} />
        <Route path="plugins" element={<Allowed route="POST /api/plugins/enabled"><PluginsScreen /></Allowed>} />
        {hosted ? <Route path="install" element={<Allowed route="GET /api/install"><InstallScreen /></Allowed>} /> : null}
        {hosted ? <Route path="account" element={<AccountScreen />} /> : null}
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
        <Route path="inbox" element={<Allowed route="GET /api/sites/:siteId/inbox"><InboxScreen /></Allowed>} />
        <Route path="history" element={<HistoryScreen />} />
        <Route path="online" element={<OnlineScreen />} />
        <Route path="redirects" element={<RedirectsScreen />} />
        <Route path="import" element={<ImportScreen />} />
        <Route path="settings" element={<Allowed route="PUT /api/sites/:siteId/config"><SiteSettingsScreen /></Allowed>} />
        <Route path="plugins" element={<Allowed route="POST /api/plugins/enabled"><SitePluginsScreen /></Allowed>} />
        <Route path="*" element={<NotFoundScreen />} />
      </Route>
    </Routes>
  );
}
