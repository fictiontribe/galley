// #region image-provider
import { ProviderError } from "@galley/plugin-kit";

// An image provider for a made-up service, "Pictures". Selectable in Settings like the built-in ones.
export default {
  name: "galley-plugin-pictures",
  apiVersion: 1,
  settings: [{ key: "apiKey", label: "Pictures API key", secret: true, required: true, env: ["PICTURES_API_KEY"] }],
  imageProviders: [
    {
      id: "pictures",
      label: "Pictures",
      keySetting: "apiKey",
      defaultModel: "pictures-1",
      supportsReferences: false,
      models: () => [{ id: "pictures-1", label: "Pictures 1", price: "$0.02 per image" }],
      async generate(request, ctx) {
        let response;

        try {
          response = await ctx.fetch("https://api.pictures.example/v1/images", {
            method: "POST",
            headers: { authorization: `Bearer ${ctx.key}`, "content-type": "application/json" },
            body: JSON.stringify({ model: request.model, prompt: request.prompt, aspect: request.aspect, n: request.count }),
            signal: ctx.signal,
          });
        } catch {
          throw new ProviderError("unavailable", "Couldn't reach Pictures. Check the internet connection, then try again.");
        }
        // Classify by status (and the service's error codes), never by the wording of its message.
        if (response.status === 401) throw new ProviderError("auth", "Pictures didn't accept the API key in Settings.", "status=401");
        if (response.status === 402) throw new ProviderError("quota", "The Pictures account is out of credit.", "status=402");
        if (response.status === 429) throw new ProviderError("rate", "Pictures is limiting requests. Wait a minute, then try again.", "status=429");
        if (!response.ok) throw new ProviderError("unavailable", "Pictures had a problem. Try again in a minute.", `status=${response.status}`);
        const body = await response.json();

        return body.images.map((image) => ({ data: new Uint8Array(Buffer.from(image.base64, "base64")), mime: "image/png", cost: image.cost }));
      },
    },
  ],
};
// #endregion image-provider
