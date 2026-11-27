<div align="center">

<a href="https://galley.fictiontribe.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/fictiontribe/galley/main/brand/logo/lockup-reverse.svg">
    <img src="https://raw.githubusercontent.com/fictiontribe/galley/main/brand/logo/lockup.svg" alt="Galley" width="200">
  </picture>
</a>

<p><strong>galleycms</strong> · CLI alias for <a href="https://www.npmjs.com/package/galley-cms"><code>galley-cms</code></a>, the open-source AI CMS for static sites</p>

<p>
<a href="https://www.npmjs.com/package/galleycms"><img alt="galleycms on npm" src="https://img.shields.io/npm/v/galleycms"></a>
<a href="https://github.com/fictiontribe/galley/actions/workflows/ci.yml"><img alt="CI on main" src="https://img.shields.io/github/actions/workflow/status/fictiontribe/galley/ci.yml?branch=main"></a>
<a href="https://github.com/fictiontribe/galley/blob/main/LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/npm/l/galleycms"></a>
</p>

<p>
<a href="https://galley.fictiontribe.com">Website</a> ·
<a href="https://galley.fictiontribe.com/tour/">Tour</a> ·
<a href="https://galley.fictiontribe.com/docs/">Docs</a> ·
<a href="https://github.com/fictiontribe/galley">GitHub</a>
</p>

</div>

```sh
npx galleycms
```

`galleycms` is an unscoped CLI alias for [`galley-cms`](https://www.npmjs.com/package/galley-cms). Every command and option is forwarded directly to `galley`:

```sh
npx galleycms doctor
npx galleycms new my-site --starter caddow
npx galleycms --help
```

To create a new site in one step, you can also run:

```sh
npm create galley@latest
```

Needs Node.js 20.11 or newer and git (22.23.4 or newer for the Astro 7 starters).

Apache-2.0. Made by [Fiction Tribe](https://www.fictiontribe.com).
