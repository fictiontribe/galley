/**
 * The environment variables that hold media storage keys. One list, read by
 * the key store and by the install (which keeps them from the site's own
 * commands and out of logs). No imports, so anything may import it.
 */
export const MEDIA_KEY_ENV = {
  accessKeyId: "GALLEY_MEDIA_ACCESS_KEY_ID",
  secretAccessKey: "GALLEY_MEDIA_SECRET_ACCESS_KEY",
  imagesToken: "GALLEY_MEDIA_IMAGES_TOKEN",
} as const;
