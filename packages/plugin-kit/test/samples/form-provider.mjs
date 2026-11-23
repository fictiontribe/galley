// #region form-provider
// A form destination: the catalogue entry the form builder shows, a server-side
// forwarder for submissions the app's inbox relays, and field introspection.
export default {
  name: "galley-plugin-formcatcher",
  apiVersion: 1,
  formProviders: [
    {
      id: "formcatcher",
      name: "Formcatcher",
      description: "Sends submissions to a Formcatcher form.",
      settings: [{ key: "formId", label: "Form ID", placeholder: "f_123", pattern: "^f_[0-9]+$", required: true }],
      canImportFields: true,
      async forward(_submission, destination, ctx) {
        const response = await ctx.fetch(`https://api.formcatcher.example/forms/${destination.settings.formId}/entries`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(ctx.payload),
        });

        // A 4xx won't get better by trying again; anything else may.
        return response.ok ? { ok: true } : { ok: false, detail: `Formcatcher answered ${response.status}.`, retry: response.status >= 500 };
      },
      async introspect(settings, ctx) {
        const response = await ctx.fetch(`https://api.formcatcher.example/forms/${settings.formId}`);
        const form = await response.json();

        return form.fields.map((field) => ({ name: field.key, label: field.title, type: field.kind, required: field.required }));
      },
    },
  ],
};
// #endregion form-provider
