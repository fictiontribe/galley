import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field } from "@/ui/Field";
import { Input } from "@/ui/Input";

const ids = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const noop = () => {};

describe("Field ids", () => {
  it("labels its one control with label-for", () => {
    const html = renderToStaticMarkup(h(Field, { label: "Title", children: h(Input, { value: "", onChange: noop }) }));
    const id = /<label[^>]*for="([^"]+)"/.exec(html)?.[1];

    expect(id).toBeTruthy();
    expect(html).toMatch(new RegExp(`<input[^>]*\\sid="${id}"`));
  });

  it("gives the several controls of a group no shared id (a list of strings)", () => {
    const html = renderToStaticMarkup(
      h(Field, {
        label: "Leads",
        group: true,
        hint: "One paragraph each",
        children: [h(Input, { key: 1, "aria-label": "Leads 1", value: "First", onChange: noop }), h(Input, { key: 2, "aria-label": "Leads 2", value: "Second", onChange: noop })],
      }),
    );
    const found = ids(html);

    expect(html).toContain("<legend");
    expect(new Set(found).size).toBe(found.length);
    expect((html.match(/<input/g) ?? []).length).toBe(2);
  });
});
