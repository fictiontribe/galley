// An invented bakery's site, the fixture for the Eleventy adapter's checks.
export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/img");
  eleventyConfig.addFilter("year", (date) => new Date(date).getFullYear());

  return {
    dir: { input: "src", output: "dist", includes: "_includes", data: "_data" },
    markdownTemplateEngine: "njk",
  };
}
