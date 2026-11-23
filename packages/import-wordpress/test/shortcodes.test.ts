import { describe, expect, it } from "vitest";
import { parseAttributes, processShortcodes } from "../src/convert/shortcodes";
import { wpautop } from "../src/convert/raw";
import { Tokens } from "../src/convert/tokens";

const run = (html: string) => {
  const tokens = new Tokens();
  const result = processShortcodes(html, { tokens, mediaById: () => undefined, attachments: () => [] });

  return { ...result, html: tokens.restore(result.html) };
};

describe("shortcodes", () => {
  it("parses attributes the way WordPress does", () => {
    expect(parseAttributes(' id="5" title=\'Contact us\' size=large https://x.example/v')).toEqual({ attrs: { id: "5", title: "Contact us", size: "large" }, positional: ["https://x.example/v"] });
    // Texturized quotes in old content still parse.
    expect(parseAttributes(" list=&#8221;spring&#8221;").attrs).toEqual({ list: "spring" });
  });

  it("keeps unknown shortcodes exactly as written, and escaped ones as literal text", () => {
    const result = run('Before [my_box color="red"]Inside[/my_box] and [[not_a_shortcode]] after [1].');

    expect(result.html).toBe('Before [my_box color="red"]Inside[/my_box] and [not_a_shortcode] after [1].');
    expect(result.unknown).toEqual(["my_box"]);
  });

  it("treats an opening tag as self-closing when no closing tag follows", () => {
    const result = run("[button_link url=/a/] text [other_code]x[/other_code]");

    expect(result.unknown).toEqual(["button_link", "other_code"]);
  });

  it("turns Divi layout shortcodes into structure and flags the builder", () => {
    const result = run('[et_pb_section][et_pb_row][et_pb_column type="1_2"][et_pb_text]<p>Hi</p>[/et_pb_text][/et_pb_column][/et_pb_row][/et_pb_section]');

    expect(result.builder).toBe("divi");
    expect(result.unknown).toEqual([]);
    expect(result.html).toContain('data-gwp-role="column" data-gwp-module="et_pb_column" data-gwp-width="50"');
  });

  it("decodes WPBakery's encoded raw HTML", () => {
    const encoded = Buffer.from(encodeURIComponent('<iframe src="https://maps.example/embed"></iframe>')).toString("base64");
    const result = run(`[vc_row][vc_column][vc_raw_html]${encoded}[/vc_raw_html][/vc_column][/vc_row]`);

    expect(result.builder).toBe("wpbakery");
    expect(result.html).toContain('<iframe src="https://maps.example/embed"></iframe>');
  });
});

describe("wpautop", () => {
  it("makes paragraphs and line breaks like WordPress, leaving <pre> alone", () => {
    expect(wpautop("One\ntwo\n\nThree\n<pre>a\n\nb</pre>")).toBe("<p>One<br />\ntwo</p>\n<p>Three</p>\n<pre>a\n\nb</pre>\n");
  });
});
