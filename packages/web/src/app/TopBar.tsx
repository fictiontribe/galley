import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FileChange } from "@galley/core/types";
import { count, friendlyLabel, joinWords } from "@/lib/format";
import { useChanges, usePendingCount } from "@/lib/stores/changes";
import { notify } from "@/lib/stores/toasts";
import { useMay } from "@/lib/may";
import { Badge, Breadcrumbs, Button, ConfirmDialog, Count, IconButton, keyName } from "@/ui";
import { AccountMenu } from "@/features/accounts/AccountMenu";
import { useChrome } from "./chrome";

// The publish dialog (and Proof's helpers it brings) loads the first time it's wanted.
const loadPublishDialog = () => import("@/features/proof/PublishDialog");
const PublishDialog = lazy(() => loadPublishDialog().then((m) => ({ default: m.PublishDialog })));

function Crumbs() {
  const { crumbs, tag } = useChrome((s) => s.topBar);
  return (
    <>
      <Breadcrumbs items={crumbs} />
      {tag ? (
        <Badge tone={tag.tone} className="app-hide-narrow">
          {tag.label}
        </Badge>
      ) : null}
    </>
  );
}

/** Top bar outside a site: breadcrumbs and the search shortcut. */
export function HomeTopBar() {
  const openPalette = useChrome((s) => s.setPaletteOpen);
  return (
    <header className="g-toolbar app-toolbar">
      <Crumbs />
      <span className="g-toolbar__spacer" />
      <IconButton icon="search" label={`Search and jump (${keyName("mod")} K)`} onClick={() => openPalette(true)} />
      <AccountMenu />
    </header>
  );
}

const NO_FILES: FileChange[] = [];

/** "Home page, About page and 2 more" for confirmations. */
function describeFiles(names: string[]): string {
  if (names.length <= 3) return joinWords(names);
  return joinWords([...names.slice(0, 2), `${names.length - 2} more`]);
}

/**
 * Said where the Publish button would be, to someone whose role doesn't
 * publish. The bar has room for a few words beside Proof, so it shows the
 * short line; the whole sentence is its tooltip and what a screen reader
 * reads, and Proof's own page says it in full too.
 */
export const NO_PUBLISH_LINE = "You can change the site and see Proof. An editor or owner publishes.";
export const NO_PUBLISH_SHORT = "An editor or owner publishes.";

/** Top bar inside a site: breadcrumbs, status tag, then Discard · Proof n · Publish. */
export function SiteTopBar({ siteId }: { siteId: string }) {
  const navigate = useNavigate();
  const pending = usePendingCount();
  const files = useChanges((s) => s.changes?.files) ?? NO_FILES;
  const discard = useChanges((s) => s.discard);
  const { publishOpen, setPublishOpen, discardOpen, setDiscardOpen } = useChrome();
  const mayPublish = useMay()("POST /api/sites/:siteId/publish");

  const [publishMounted, setPublishMounted] = useState(false);
  useEffect(() => {
    if (publishOpen) setPublishMounted(true);
  }, [publishOpen]);
  const names = files.map((file) => file.title ?? friendlyLabel(file.path));
  const changesWord = count(pending, "change");

  return (
    <header className="g-toolbar app-toolbar">
      <Crumbs />
      <span className="g-toolbar__spacer" />
      <Button variant="quiet" size="sm" className="app-hide-narrow" disabled={pending === 0} onClick={() => setDiscardOpen(true)}>
        Discard
      </Button>
      <Button variant="secondary" size="sm" onClick={() => navigate(`/sites/${siteId}/proof`)}>
        Proof <Count value={pending} quiet label={`${changesWord} to proof`} />
      </Button>
      {mayPublish ? (
        <Button
          variant="primary"
          size="sm"
          disabled={pending === 0}
          title={pending === 0 ? "Nothing to publish" : undefined}
          onPointerEnter={() => void loadPublishDialog()}
          onFocus={() => void loadPublishDialog()}
          onClick={() => setPublishOpen(true)}
        >
          Publish
        </Button>
      ) : (
        <span className="accounts-no-publish" title={NO_PUBLISH_LINE}>
          <span aria-hidden="true">{NO_PUBLISH_SHORT}</span>
          <span className="g-sr">{NO_PUBLISH_LINE}</span>
        </span>
      )}
      <AccountMenu />

      {mayPublish && (publishMounted || publishOpen) ? (
        <Suspense fallback={null}>
          <PublishDialog siteId={siteId} open={publishOpen} onClose={() => setPublishOpen(false)} />
        </Suspense>
      ) : null}
      <ConfirmDialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title={`Discard ${changesWord}?`}
        body={`This removes your unpublished edits to ${describeFiles(names)}. What’s already published stays as it is.`}
        confirmLabel={`Discard ${changesWord}`}
        busyLabel="Discarding…"
        errorTitle="Couldn’t discard"
        onConfirm={async () => {
          await discard();
          notify({ tone: "neutral", title: "Changes discarded", body: "The site is back to its last published version." });
        }}
      />
    </header>
  );
}
