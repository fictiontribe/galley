/**
 * "Share with the community": the address of GitHub's new-file page for the
 * public repository's themes/ folder, with the file's name and contents
 * filled in. The person proposes it there with their own GitHub account;
 * nothing is sent from the app (it only opens this address in a new tab).
 * A theme is a few hundred bytes, well within what an address can carry.
 */
import { REPOSITORY_URL } from "../brand";
import { themeFileText, type ThemeFile } from "./contract";

/** The folder in the repository that holds community themes, and the branch proposals start from. */
export const COMMUNITY_FOLDER = "themes";
export const COMMUNITY_BRANCH = "main";

export function communityShareUrl(theme: ThemeFile, repository: string = REPOSITORY_URL): string {
  // encodeURIComponent, not URLSearchParams: a space is %20 rather than "+", which every reader of the address takes the same way.
  return `${repository.replace(/\/+$/, "")}/new/${COMMUNITY_BRANCH}/${COMMUNITY_FOLDER}?filename=${encodeURIComponent(`${theme.id}.json`)}&value=${encodeURIComponent(themeFileText(theme))}`;
}
