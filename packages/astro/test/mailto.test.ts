// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://www.example.com/contact/" }
// The email-link dialog: what each option opens for the hard cases, and how
// it behaves with a pointer, a keyboard and a screen reader.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAILTO_CSS, MAILTO_STRINGS, mailtoScript, resolveMailto } from "../src/mailto/config.js";
import { MAILTO_RUNTIME } from "../src/mailto/runtime.gen.js";

type Links = { message: { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string }; gmail: string; outlook: string; "outlook-live": string; app: string };
let api: { parse: (href: string) => Links["message"]; links: (href: string) => Links };

beforeAll(() => {
  new Function(`return ${MAILTO_RUNTIME}`)()({ ...resolveMailto(undefined), css: MAILTO_CSS });
  api = (window as any).galleyMailto;
});

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.querySelectorAll("style").forEach((style) => style.remove());
});

describe("reading a mailto: link (RFC 6068)", () => {
  const cases: Array<[string, Partial<Links["message"]>]> = [
    ["mailto:kim@example.com", { to: ["kim@example.com"], subject: "", body: "" }],
    ["MAILTO:Kim@Example.com", { to: ["Kim@Example.com"] }],
    ["mailto:kim@example.com,lee@example.com", { to: ["kim@example.com", "lee@example.com"] }],
    ["mailto:kim%40example.com", { to: ["kim@example.com"] }],
    ["mailto:kim+news@example.com", { to: ["kim+news@example.com"] }],
    ["mailto:?to=kim@example.com&to=lee@example.com", { to: ["kim@example.com", "lee@example.com"] }],
    ["mailto:kim@example.com?cc=a@example.com,b@example.com&bcc=c@example.com", { cc: ["a@example.com", "b@example.com"], bcc: ["c@example.com"] }],
    ["mailto:kim@example.com?Subject=Hello%20there&CC=a@example.com", { subject: "Hello there", cc: ["a@example.com"] }],
    // "+" is a plus sign in mailto:, not a space (a common mistake made by URL builders).
    ["mailto:kim@example.com?subject=1+1%3D2", { subject: "1+1=2" }],
    ["mailto:kim@example.com?subject=Caf%C3%A9%20%E2%80%94%20%E6%97%A5%E6%9C%AC", { subject: "Café — 日本" }],
    ["mailto:kim@example.com?body=Line%20one%0D%0ALine%20two%0ALine%20three", { body: "Line one\nLine two\nLine three" }],
    ["mailto:kim@example.com?body=100%25%20sure%20%26%20happy", { body: "100% sure & happy" }],
    ["mailto:kim@example.com?subject=50%%20off", { subject: "50% off" }],
    ["mailto:kim@example.com?subject=bad%E2%28%A1", { subject: "bad%E2(%A1" }],
    ["mailto:kim@example.com?subject=first&subject=second", { subject: "first" }],
    ["mailto:kim@example.com?in-reply-to=%3C1@x%3E&body=hi", { body: "hi" }],
    ["mailto:", { to: [] }],
    ["mailto:?subject=Feedback", { to: [], subject: "Feedback" }],
  ];

  for (const [href, expected] of cases) {
    it(href, () => expect(api.parse(href)).toMatchObject(expected));
  }
});

describe("what each option opens", () => {
  const href = "mailto:kim@example.com,lee+team@example.com?cc=a@example.com&bcc=b@example.com&subject=Caf%C3%A9%20%26%20tea&body=Hi%0D%0A1+1%3D2";

  it("Gmail: the web compose window with every part carried over, percent-encoded", () => {
    expect(api.links(href).gmail).toBe(
      "https://mail.google.com/mail/?view=cm&fs=1&to=kim%40example.com%2Clee%2Bteam%40example.com&cc=a%40example.com&bcc=b%40example.com&su=Caf%C3%A9%20%26%20tea&body=Hi%0A1%2B1%3D2",
    );
  });

  it("Outlook on the web: the compose deep link (%20 for spaces, never +)", () => {
    const outlook = api.links(href).outlook;

    expect(outlook).toBe("https://outlook.office.com/mail/deeplink/compose?to=kim%40example.com%2Clee%2Bteam%40example.com&cc=a%40example.com&bcc=b%40example.com&subject=Caf%C3%A9%20%26%20tea&body=Hi%0A1%2B1%3D2");
    expect(outlook).not.toContain("+");
    expect(api.links(href)["outlook-live"]).toBe(outlook.replace("https://outlook.office.com/mail/deeplink/compose", "https://outlook.live.com/mail/0/deeplink/compose"));
  });

  it("the mail app: the original link exactly as written", () => {
    expect(api.links(href).app).toBe(href);
  });

  it("round-trips through the browser's own URL parser", () => {
    const url = new URL(api.links(href).gmail);

    expect(url.searchParams.get("to")).toBe("kim@example.com,lee+team@example.com");
    expect(url.searchParams.get("su")).toBe("Café & tea");
    expect(url.searchParams.get("body")).toBe("Hi\n1+1=2");
  });

  it("leaves out what the link doesn't have", () => {
    expect(api.links("mailto:kim@example.com").gmail).toBe("https://mail.google.com/mail/?view=cm&fs=1&to=kim%40example.com");
  });
});

describe("the dialog", () => {
  const page = (html = '<p>Write to <a id="mail" href="mailto:kim@example.com?subject=Hello">kim@example.com</a> or <a id="web" href="/about/">read more</a>.</p>') => {
    document.body.innerHTML = `<main>${html}</main>`;
    return document.getElementById("mail") as HTMLAnchorElement;
  };
  const dialog = () => document.querySelector<HTMLElement>(".galley-mailto");
  const click = (element: Element, init: MouseEventInit = {}) => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });

    element.dispatchEvent(event);
    return event;
  };

  it("opens next to the link on click, with the address and four actions in order; focus moves in", () => {
    const link = page();
    const event = click(link);
    const box = dialog()!;

    expect(event.defaultPrevented).toBe(true);
    expect(box.getAttribute("role")).toBe("dialog");
    expect(box.getAttribute("aria-label")).toBe("Email kim@example.com");
    expect(box.querySelector(".galley-mailto__address")!.textContent).toBe("kim@example.com");
    expect([...box.querySelectorAll(".galley-mailto__option")].map((option) => [option.getAttribute("data-option"), option.textContent])).toEqual([
      ["gmail", "Send with Gmail"],
      ["outlook", "Send with Outlook"],
      ["app", "Open my mail app"],
      ["copy", "Copy address"],
    ]);
    const [gmail, , app] = [...box.querySelectorAll<HTMLAnchorElement>("a.galley-mailto__option")];

    expect(gmail!.target).toBe("_blank");
    expect(gmail!.rel).toBe("noopener noreferrer");
    expect(app!.getAttribute("href")).toBe("mailto:kim@example.com?subject=Hello");
    expect(app!.target).toBe("");
    expect(document.activeElement).toBe(gmail);
    expect(box.style.position === "" || box.style.top !== "").toBe(true);
    expect(document.head.querySelector("style")!.textContent).toBe(MAILTO_CSS);
  });

  it("the mail-app option inside the dialog is a normal mailto: link, not intercepted again", () => {
    click(page());
    const app = dialog()!.querySelector<HTMLAnchorElement>('[data-option="app"]')!;
    const event = click(app);

    expect(event.defaultPrevented).toBe(false);
  });

  it("never intercepts a modified click, another button, a download link or an opted-out link", () => {
    const link = page();

    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      expect(click(link, init).defaultPrevented, JSON.stringify(init)).toBe(false);
      expect(dialog()).toBeNull();
    }
    const off = page('<a id="mail" href="mailto:a@example.com" data-galley-mailto="off">a</a>');

    expect(click(off).defaultPrevented).toBe(false);
    const inside = page('<div data-galley-mailto="off"><a id="mail" href="mailto:a@example.com">a</a></div>');

    expect(click(inside).defaultPrevented).toBe(false);
    const download = page('<a id="mail" href="mailto:a@example.com" download>a</a>');

    expect(click(download).defaultPrevented).toBe(false);
    expect(dialog()).toBeNull();
  });

  it("stays out of the way when something else already handled the click (the editor's click-to-edit mode)", () => {
    const link = page();
    const swallow = (event: Event) => event.preventDefault();

    window.addEventListener("click", swallow, true);
    click(link);
    window.removeEventListener("click", swallow, true);
    expect(dialog()).toBeNull();
  });

  it("opens with Space as well as Enter (which browsers turn into a click)", () => {
    const link = page();

    link.focus();
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });

    link.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    expect(dialog()).not.toBeNull();
  });

  it("arrow keys move between the actions; Escape closes and returns focus to the link", () => {
    const link = page();

    click(link);
    const options = [...dialog()!.querySelectorAll<HTMLElement>(".galley-mailto__option")];
    const key = (name: string) => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));

    key("ArrowDown");
    expect(document.activeElement).toBe(options[1]);
    key("ArrowUp");
    key("ArrowUp");
    expect(document.activeElement).toBe(options[3]);
    key("Home");
    expect(document.activeElement).toBe(options[0]);
    key("End");
    expect(document.activeElement).toBe(options[3]);
    key("Escape");
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(link);
  });

  it("closes on a click outside; one dialog at a time; clicking the link again closes it", () => {
    const link = page('<a id="mail" href="mailto:a@example.com">a</a> <a id="other" href="mailto:b@example.com">b</a> <span id="plain">text</span>');

    click(link);
    click(document.getElementById("other")!);
    expect(document.querySelectorAll(".galley-mailto")).toHaveLength(1);
    expect(dialog()!.getAttribute("aria-label")).toBe("Email b@example.com");
    document.getElementById("plain")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(dialog()).toBeNull();
    click(link);
    click(link);
    expect(dialog()).toBeNull();
  });

  it("copies the address and says so to screen readers", async () => {
    const writeText = vi.fn(async () => undefined);

    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    click(page('<a id="mail" href="mailto:kim@example.com,lee@example.com">us</a>'));
    const status = dialog()!.querySelector(".galley-mailto__status")!;

    expect(status.getAttribute("role")).toBe("status");
    (dialog()!.querySelector('[data-option="copy"]') as HTMLButtonElement).click();
    await new Promise((done) => setTimeout(done, 0));
    expect(writeText).toHaveBeenCalledWith("kim@example.com, lee@example.com");
    expect(status.textContent).toBe("Copied");
  });

  it("offers no copy for a link without an address", () => {
    click(page('<a id="mail" href="mailto:?subject=Feedback">feedback</a>'));
    expect(dialog()!.getAttribute("aria-label")).toBe("Write an email");
    expect(dialog()!.querySelector('[data-option="copy"]')).toBeNull();
  });

  it("works for links added later and inside a form's thank-you", () => {
    page("");
    document.querySelector("main")!.innerHTML = '<div class="galley-form__success"><p>Or email <a id="later" href="mailto:help@example.com">help@example.com</a>.</p></div>';
    click(document.getElementById("later")!);
    expect(dialog()).not.toBeNull();
  });
});

describe("settings", () => {
  it("lets a site remove and reorder actions and change any word", () => {
    expect(resolveMailto({ options: ["copy", "app"], strings: { copy: "Copy" } })).toEqual({ options: ["copy", "app"], strings: { ...MAILTO_STRINGS, copy: "Copy" } });
    expect(resolveMailto(false)).toBeNull();
    expect(() => resolveMailto({ options: ["yahoo"] })).toThrow('mailto.options can only list "gmail", "outlook", "app", "copy", "outlook-live".');
  });

  it("is one constant script per site, with no way for wording to close the tag", () => {
    const text = mailtoScript(resolveMailto({ strings: { copy: "</script><b>" } })!);

    expect(text).not.toContain("</script>");
    expect(text).toContain("\\u003c/script>");
  });

});
