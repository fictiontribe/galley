// #region minimal
// galley-plugin-hello — the smallest useful plugin: one file, no dependencies, no build step.
export default {
  name: "galley-plugin-hello",
  version: "1.0.0",
  apiVersion: 1,
  tools: [
    {
      name: "say_hello",
      title: "Say hello",
      description: "Greet someone by name. Read-only; use it when the person asks the assistant to say hello.",
      input: { type: "object", properties: { name: { type: "string", description: "Who to greet." } }, required: ["name"] },
      mode: "content",
      effect: { readOnly: true },
      run: (input) => `Hello, ${input.name}.`,
    },
  ],
};
// #endregion minimal
