import { getCollection, type CollectionEntry } from "astro:content";
import docsData from "../data/docs.json";
import { renderMarkdown, type Heading } from "./markdown";

export type Doc = CollectionEntry<"docs">;

export interface DocLink {
  id: string;
  href: string;
  title: string;
  navTitle: string;
  description: string;
  /** Section headings, used by the client-side filter. */
  terms: string;
}

export interface DocGroup {
  id: string;
  label: string;
  items: DocLink[];
}

export function docHref(id: string): string {
  return id === "index" ? "/docs/" : `/docs/${id.replace(/\/index$/, "")}/`;
}

const groupOrder = new Map(docsData.groups.map((group, i) => [group.id, i]));

/** Every published doc in reading order: by group (docs.json), then `order`, then title. */
export async function getDocs(): Promise<Doc[]> {
  const docs = await getCollection("docs", (doc) => !doc.data.draft);
  return docs.sort((a, b) => {
    const ga = groupOrder.get(a.data.group) ?? 999;
    const gb = groupOrder.get(b.data.group) ?? 999;
    if (ga !== gb) return ga - gb;
    if (a.data.order !== b.data.order) return a.data.order - b.data.order;
    return a.data.title.localeCompare(b.data.title);
  });
}

export function headingsOf(doc: Doc): Heading[] {
  return renderMarkdown(doc.body ?? "").headings;
}

export function toLink(doc: Doc): DocLink {
  return {
    id: doc.id,
    href: docHref(doc.id),
    title: doc.data.title,
    navTitle: doc.data.navTitle ?? doc.data.title,
    description: doc.data.description,
    terms: headingsOf(doc)
      .filter((h) => h.depth <= 3)
      .map((h) => h.text)
      .join(" · "),
  };
}

export async function getDocGroups(): Promise<DocGroup[]> {
  const docs = await getDocs();
  const groups: DocGroup[] = [];
  for (const doc of docs) {
    const label = docsData.groups.find((g) => g.id === doc.data.group)?.label ?? doc.data.group;
    let group = groups.find((g) => g.id === doc.data.group);
    if (!group) {
      group = { id: doc.data.group, label, items: [] };
      groups.push(group);
    }
    group.items.push(toLink(doc));
  }
  return groups;
}
