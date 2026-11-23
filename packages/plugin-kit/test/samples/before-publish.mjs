// #region before-publish
// A publish gate: refuses a publish while a page still says "Lorem ipsum".
export default {
  name: "galley-plugin-no-lorem",
  apiVersion: 1,
  hooks: {
    async beforePublish(ctx, changes) {
      for (const file of changes.files) {
        if (file.kind !== "content" || file.status === "deleted") continue;
        const { content } = await ctx.site.readFile(file.path);

        if (/lorem ipsum/i.test(content)) return { refuse: `“${file.title ?? file.path}” still has placeholder text (Lorem ipsum).` };
      }
    },
  },
};
// #endregion before-publish
