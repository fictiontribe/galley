# Community themes

Themes for Galley's editing app, made by the people who use it. Every file
here comes with the app when it is built: in the app, the theme picker's
**Browse community themes** lists them, with no network.

A theme is a small file: five colours for light (and optionally dark) and four
choices about materials. The contract is in
[`brand/themes/README.md`](../brand/themes/README.md); how the app uses themes
is [`docs/themes.md`](../docs/themes.md).

## Add one

The easy way: make it in the app (**Settings › Themes › Make a theme from this
one**), then **Share with the community**. That opens GitHub with the file
already filled in, here; you propose it with your own GitHub account.

By hand:

1. Make it in the app, or write it by hand from
   [`quiet.json`](../brand/themes/quiet.json). Name the file after its id:
   `"id": "harbour"` → `harbour.json`.
2. Check it: `galley theme check harbour.json` (or import it in the app and
   read the report). If the check adjusts a colour, use the adjusted value:
   **Export** in the app, or `galley theme add` then `galley theme export`,
   writes it.
3. Add `"author"` with the name you want shown, and a one-sentence
   `"description"`.
4. Open a pull request adding the file to this folder.

## What gets merged

- It passes the check unchanged. `packages/core/test/themes/check.test.ts`
  runs the check over every file here and in `brand/themes/`, so a theme that
  would be refused or adjusted fails the build.
- Its file name is its id, and the id isn't one of the built-ins (`quiet`,
  `plate`, `desk`) or another file here.
- Its name and description are your own words, with no product or company
  names that aren't yours.
- It looks different enough from the themes already here to be worth a place
  in the picker.

By proposing a theme you agree it is published under the repository's
licence (Apache-2.0), like any other contribution (see
[CONTRIBUTING.md](../CONTRIBUTING.md)).
