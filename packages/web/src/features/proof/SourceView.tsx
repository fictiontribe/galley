import type { FileChange } from "@galley/core/types";
import { fileName } from "@/lib/format";
import { EmptyState, ErrorState, Skeleton } from "@/ui";
import { SourceDiff } from "@/ui/diff";
import { useFileDiff } from "./useFileDiff";

/** "Source": the file's changed lines, for the people who want them. */
export function SourceView({ siteId, change }: { siteId: string; change: FileChange }) {
  const diff = useFileDiff(siteId, change, !change.binary);

  if (change.binary) {
    return <EmptyState compact mark="reg" title="An image has no lines to show." body="What changed shows the image before and after." />;
  }
  if (diff.loading) {
    return (
      <div aria-busy="true" className="proof-source">
        <Skeleton lines={8} />
      </div>
    );
  }
  if (!diff.data) return <ErrorState compact title="Couldn’t show the source" error={diff.error} onRetry={() => void diff.refetch()} />;
  if (diff.data.hunks.length === 0) {
    return <EmptyState compact mark="stet" title="No lines changed." body="Only the file’s details changed, such as its line endings." />;
  }
  return (
    <div className="proof-source">
      <p className="g-file__path proof-source__path">{change.path}</p>
      <SourceDiff hunks={diff.data.hunks} label={fileName(change.path)} />
    </div>
  );
}
