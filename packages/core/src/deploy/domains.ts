/**
 * Host names people type for their own domain: "https://Example.com/about"
 * becomes "example.com"; anything that can't be a public host name is refused
 * with a sentence. Pure, so the UI can use the same rules.
 */
import { DeployError } from "./errors";

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** The hosts' own addresses: a site already has one of these. */
const HOST_DEFAULTS = [/\.workers\.dev$/, /\.pages\.dev$/, /\.vercel\.app$/];

export function normalizeHostname(input: string): string {
  let text = input.trim().toLowerCase();

  text = text.replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  return text;
}

/** The plain reason `hostname` can't be used, or null. */
export function hostnameProblem(hostname: string): string | null {
  if (!hostname) return "Type the address, for example “www.example.com”.";
  if (hostname.includes("*")) return "Wildcard addresses can't be used. Type one address, for example “www.example.com”.";
  const labels = hostname.split(".");

  if (hostname.length > 253 || labels.length < 2 || !labels.every((label) => LABEL.test(label)) || !/^[a-z]{2,63}$/.test(labels.at(-1)!)) {
    return "That doesn't look like an address. Type it like “www.example.com”, without spaces.";
  }
  if (HOST_DEFAULTS.some((pattern) => pattern.test(hostname))) return "That's one of the host's own addresses. Use an address on a domain you own.";
  return null;
}

export function requireHostname(input: string): string {
  const hostname = normalizeHostname(input);
  const problem = hostnameProblem(hostname);

  if (problem) throw new DeployError("domain", problem, input);
  return hostname;
}

/** "example.com" for "www.example.com" — a guess at the registered domain, only used in sentences. */
export function apexOf(hostname: string): string {
  return hostname.split(".").slice(-2).join(".");
}
