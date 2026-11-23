import { useEffect } from "react";
import { useMeta } from "@/lib/stores/meta";
import { useChrome } from "./chrome";

/** Keeps document.title as "<current page> · <product name>", the name coming from /api/meta. */
export function useDocumentTitle(): void {
  const productName = useMeta((s) => s.meta?.brand.productName ?? "");
  const crumbs = useChrome((s) => s.topBar.crumbs);
  const page = crumbs[crumbs.length - 1]?.label;
  useEffect(() => {
    document.title = page && productName ? `${page} · ${productName}` : productName;
  }, [page, productName]);
}
