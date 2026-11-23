/**
 * The Cloudflare sync against the real API, for the owner to run once with a
 * real key on a throwaway zone (it has only ever run against the fake):
 *
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… GALLEY_LIVE_HOSTNAME=redirects-test.example.com \
 *     pnpm --filter @galley/core exec tsx test/redirects/live-cloudflare.mts
 *
 * The key needs Account › Account Filter Lists › Edit and Account › Bulk URL
 * Redirects › Edit. It checks the permissions, plans three redirects,
 * applies them (polling Cloudflare's list operation), checks Cloudflare
 * matches, applies again to prove nothing is sent the second time, asks the
 * domain for one of them when its traffic goes through Cloudflare, then
 * takes everything it made off Cloudflare again. Nothing else in the
 * account is touched; the key is never printed.
 */
import { applyCloudflare, checkCloudflare, planCloudflare, probeCloudflare, removeCloudflare, CLOUDFLARE_API, type Redirect } from "../../src/redirects/index";

const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const hostname = process.env.GALLEY_LIVE_HOSTNAME?.trim();

if (!token || !account || !hostname) {
  console.error("Set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and GALLEY_LIVE_HOSTNAME (a throwaway domain on that account).");
  process.exit(2);
}
let calls = 0;
const counting: typeof fetch = (input, init) => {
  if ((init?.method ?? "GET") !== "GET") calls += 1;
  return fetch(input, init);
};
const api = { token, fetch: counting, apiBase: CLOUDFLARE_API };
const target = { account, hostnames: [hostname], siteId: "livecheck000000", siteName: "Live check (safe to delete)" };
const list: Redirect[] = [
  { from: "/galley-live-a/", to: "/", status: 301 },
  { from: "/galley-live-b/", to: "https://example.com/", status: 302 },
  { from: "/galley-live-folder/*", to: "/:splat", status: 308 },
];
const step = (text: string) => console.log(`• ${text}`);

try {
  const probe = await probeCloudflare(api, account);

  if (probe.missing.length) throw new Error(`The key is missing: ${probe.missing.join(", ")}`);
  step("The key can read lists and redirect rules.");
  const first = await planCloudflare(api, target, list);

  step(`Plan: list ${first.plan.list}, rule ${first.plan.rule}, add ${first.plan.add}, change ${first.plan.change}, remove ${first.plan.remove}.`);
  await applyCloudflare(api, target, list, first.plan.id, (progress) => step(progress.detail));
  const check = await checkCloudflare(api, target, list);

  if (!check.matches) throw new Error(`After applying, Cloudflare differs: ${check.differences.join(" ")}`);
  step("Cloudflare matches the list.");
  const again = await planCloudflare(api, target, list);
  const before = calls;

  await applyCloudflare(api, target, list, again.plan.id, () => undefined);
  if (calls !== before) throw new Error(`Applying the same list again sent ${calls - before} changing requests; it should send none.`);
  step("Applying the same list again changed nothing.");
  try {
    const response = await fetch(`https://${hostname}/galley-live-a/`, { redirect: "manual" });

    step(`https://${hostname}/galley-live-a/ answered ${response.status} → ${response.headers.get("location") ?? "(no location)"} (expect 301 → https://${hostname}/ when the domain's traffic goes through Cloudflare).`);
  } catch (error) {
    step(`Couldn't ask the domain itself (${error instanceof Error ? error.message : String(error)}); the API side is verified.`);
  }
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message.split(token).join("[redacted]") : String(error)}`);
  process.exitCode = 1;
} finally {
  await removeCloudflare(api, target).then(
    (result) => step(result.removed ? "Took the list and rule off Cloudflare again." : "Nothing of this check was left on Cloudflare."),
    (error: unknown) => console.error(`✗ Couldn't clean up: ${error instanceof Error ? error.message : String(error)} — remove the list “galley_redirects_livecheck000” and its rule by hand.`)
  );
}
