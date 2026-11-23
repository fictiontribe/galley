// #region importer
// "Bring content in from X": shown in the app's import list, and run by `galley import notes <folder>`.
export default {
  name: "galley-plugin-import-notes",
  apiVersion: 1,
  importers: [
    {
      id: "notes",
      name: "Plain notes",
      description: "Every .txt file in a folder, as a draft post.",
      input: "file",
      command: {
        help: "Usage: galley import notes <folder>\n\nTurn each .txt file in the folder into a draft post.",
        async run(argv, io) {
          if (argv.length !== 1) {
            io.err("Say which folder to read.");
            return 2;
          }
          io.out(`Would import the notes in ${argv[0]}.`);
          return 0;
        },
      },
    },
  ],
};
// #endregion importer
