/**
 * Where this app keeps things and does its work, in the words a person
 * reads. Locally that is this computer. A hosted install runs on a server,
 * where "this computer" would mean the visitor's own machine — so there it
 * is the server, in this editor's own data. Local words are exactly the ones
 * the screens always used.
 */
import { useHostedInstall } from "./stores/meta";

export interface PlaceWords {
  /** Where a version (or an undo) is recorded: "on this computer" / "in this editor". */
  recorded: string;
  /** Where a pasted key is stored: "on this computer only" / "on the server, in this editor’s own data". */
  keyStore: string;
  /** Whose settings a fallback comes from: "this computer’s" / "the server’s". */
  machines: string;
}

const LOCAL: PlaceWords = { recorded: "on this computer", keyStore: "on this computer only", machines: "this computer’s" };
const HOSTED: PlaceWords = { recorded: "in this editor", keyStore: "on the server, in this editor’s own data", machines: "the server’s" };

export function placeWords(hosted: boolean): PlaceWords {
  return hosted ? HOSTED : LOCAL;
}

export function usePlaceWords(): PlaceWords {
  return placeWords(useHostedInstall());
}
