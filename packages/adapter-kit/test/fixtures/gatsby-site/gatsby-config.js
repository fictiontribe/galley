module.exports = {
  siteMetadata: { title: "Harbour notes", siteUrl: "https://harbour-notes.example" },
  plugins: [
    { resolve: "gatsby-source-filesystem", options: { path: `${__dirname}/content/blog`, name: "blog" } },
    "gatsby-transformer-remark",
  ],
};
