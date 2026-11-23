// The classic CommonJS config, with Eleventy's default folders.
module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("img");
  return { dir: { output: "_site" } };
};
