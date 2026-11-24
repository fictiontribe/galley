/**
 * The demo's own layer, outside the app's tree: the band at the top of the
 * window that says what this is (and the way out), and the walkthrough.
 */
import type { MockServer } from "../../mock/server.ts";
import { DemoBand } from "./DemoBand";
import { Tour } from "../tour/Tour";

export function DemoLayer({ server, siteId, sampleVersions }: { server: MockServer; siteId: string; sampleVersions: number }) {
  return (
    <>
      <DemoBand />
      <Tour server={server} siteId={siteId} sampleVersions={sampleVersions} />
    </>
  );
}
