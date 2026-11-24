/**
 * A person's display name, as it is kept and as it is compared.
 *
 * A name is shown beside what its owner did — on a publish, in the list of
 * people, in an e-mail — so two things are kept out of it: characters that
 * take no room on the screen but change what a reader sees (the order of the
 * letters, or nothing at all), and a name that reads as someone else's.
 *
 * What this does not catch: look-alike letters from different scripts (a
 * Cyrillic "а" for a Latin "a"). Telling those apart needs the Unicode
 * confusables table, which isn't here. Two names that differ only that way
 * are two names.
 */

const ZWNJ = 0x200c;
const ZWJ = 0x200d;
const BLACK_FLAG = 0x1f3f4;
const TAG_END = 0xe007f;

/**
 * Never part of a name. The controls that reorder text (U+202A–202E,
 * U+2066–2069, U+200E, U+200F, U+061C); characters with no width (zero-width
 * space, word joiner, byte-order mark, soft hyphen, the invisible operators,
 * the grapheme joiner, the Mongolian vowel separator, the annotation and
 * musical format marks); and fillers that show as nothing (the Hangul
 * fillers, the Khmer inherent vowels, the blank Braille pattern).
 */
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0\uFFF9-\uFFFB\u{1D173}-\u{1D17A}]/gu;
/** Controls: a line break or a tab in a name is a space. */
const CONTROL = /[\u0000-\u001F\u007F-\u009F]+/g;
const LETTER_OR_MARK = /[\p{L}\p{M}]/u;
const MARK = /\p{M}/u;
/** Scripts whose words never need a joiner between two letters. */
const UNJOINED = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u;
const PICTURE = /\p{Extended_Pictographic}/u;
/** What an emoji can end with before a joiner: the picture itself, a skin tone, the "as an emoji" selector, the end of a flag's tags. */
const PICTURE_END = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\uFE0F\u{E007F}]/u;

const isTag = (point: number) => point >= 0xe0000 && point <= 0xe007f;
const isJoiner = (point: number) => point === ZWNJ || point === ZWJ;
const charOf = (point: number | undefined) => (point === undefined ? "" : String.fromCodePoint(point));

/**
 * The name with what no reader sees taken out, and single spaces. A
 * zero-width joiner or non-joiner stays only where writing needs it: between
 * two letters of a script that joins its letters (a Persian word, an Indic
 * conjunct), or inside an emoji made of several (a family). Tag characters
 * stay only as the spelling of a flag.
 */
export function tidyName(raw: string): string {
  const points = [...raw.replace(CONTROL, " ").replace(INVISIBLE, "")].map((char) => char.codePointAt(0)!);
  const kept: number[] = [];

  for (let at = 0; at < points.length; at += 1) {
    const point = points[at]!;

    if (isTag(point)) continue;
    if (!isJoiner(point)) {
      kept.push(point);
      if (point !== BLACK_FLAG) continue;
      // A flag of a part of a country is the black flag, tag letters, and the tag that ends them. Only a whole one is kept.
      let end = at + 1;

      while (end < points.length && isTag(points[end]!) && points[end] !== TAG_END && points[end]! >= 0xe0020) end += 1;
      if (end > at + 1 && points[end] === TAG_END) {
        kept.push(...points.slice(at + 1, end + 1));
        at = end;
      }
      continue;
    }
    let next = at + 1;

    while (next < points.length && isJoiner(points[next]!)) next += 1;
    const before = charOf(kept.at(-1));
    const after = charOf(points[next]);
    // The letter a mark sits on says which script the word is in.
    let base = kept.length - 1;

    while (base > 0 && MARK.test(charOf(kept[base]))) base -= 1;
    const inWord = LETTER_OR_MARK.test(before) && LETTER_OR_MARK.test(after) && !(UNJOINED.test(charOf(kept[base])) && UNJOINED.test(after));
    const inEmoji = point === ZWJ && PICTURE_END.test(before) && PICTURE.test(after);

    if (inWord || inEmoji) kept.push(point);
    at = next - 1;
  }
  return kept
    .map((point) => String.fromCodePoint(point))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Left out when two names are compared: every format character, the selectors that only choose a glyph, and the fillers. */
const UNSEEN = /[\p{Cf}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180D\u180F\u2800\u3164\uFFA0\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;

/**
 * What two names are compared by: the same key means a reader would take
 * them for one name. Compatibility forms are folded together (full-width
 * letters, ligatures), then case, and nothing unseen counts.
 */
export function nameKey(name: string): string {
  const folded = name.normalize("NFKC").replace(UNSEEN, "").toUpperCase().toLowerCase();

  return folded.normalize("NFKC").replace(UNSEEN, "").replace(/\s+/g, " ").trim();
}
