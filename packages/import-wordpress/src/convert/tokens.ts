/**
 * Placeholders that carry text through the Markdown conversion untouched.
 *
 * Kept HTML (an iframe, a video) and shortcodes left in place must reach the
 * Markdown exactly as written. Turndown escapes Markdown punctuation in text
 * and re-renders elements, so they travel as plain letters-and-digits tokens
 * (nothing in them needs escaping) and are swapped back afterwards.
 */
export class Tokens {
  private readonly values = new Map<string, string>();
  private readonly prefix: string;

  constructor() {
    // A random stem means content can never collide with a token by accident.
    this.prefix = `GWPTOK${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  /** A token for inline text. */
  inline(value: string): string {
    const token = `${this.prefix}${this.values.size}Z`;

    this.values.set(token, value);
    return token;
  }

  /** A token that stands as its own paragraph (raw HTML blocks). */
  block(value: string): string {
    return `<p>${this.inline(`\n\n${value.trim()}\n\n`)}</p>`;
  }

  has(text: string): boolean {
    return text.includes(this.prefix);
  }

  restore(text: string): string {
    if (!this.has(text)) return text;
    const pattern = new RegExp(`${this.prefix}\\d+Z`, "g");
    // Tokens can nest (a kept shortcode around kept HTML), so restore until none are left.
    let out = text;

    for (let guard = 0; guard < 5 && this.has(out); guard += 1) {
      out = out.replace(pattern, (token) => this.values.get(token) ?? token);
    }
    return out;
  }
}
