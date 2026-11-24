/**
 * Cutting secrets out of text a hosted install writes to its log.
 *
 * The engine remembers every key it has read (ai/errors.ts); the server adds
 * what only it knows (the password from the environment, the setup code, the
 * data folder's stored keys) through `values`. Addresses get the values of
 * their token=, ticket=, key= and passphrase= parameters cut too, whoever
 * wrote them.
 */
import { rememberSecret, scrubSecrets } from "../ai/errors";

export { rememberSecret };

/** Shorter values are left alone: cutting "1234" out of every line would hide more than it protects. */
export const MIN_SCRUBBED_LENGTH = 6;
const REDACTED = "[redacted]";
/** `token=…`, `access_token=…`, `ticket=…`, `api_key=…`, `passphrase=…` in an address or a form body. */
const SECRET_PARAMETER = /((?:^|[?&#;\s,("'])[\w.-]*?(?:token|ticket|key|passphrase|password)=)[^&#\s"'<>)]+/gi;

/** `text` with every given value, every key the engine knows and every secret-looking address parameter cut out. */
export function scrubLine(text: string, values: Iterable<string> = []): string {
  let out = text;
  const sorted = [...new Set([...values].filter((value) => typeof value === "string" && value.length >= MIN_SCRUBBED_LENGTH))].sort((a, b) => b.length - a.length);

  for (const value of sorted) if (out.includes(value)) out = out.split(value).join(REDACTED);
  out = out.replace(SECRET_PARAMETER, `$1${REDACTED}`);
  return scrubSecrets(out);
}
