/**
 * "Saved for me" and the chosen theme belong to one person: another account
 * on the same browser starts with none of them, signing out forgets them,
 * and whatever was stored is read back only as far as it holds themes.
 */
import { describe, expect, it } from "vitest";
import { QUIET } from "@galley/core/themes";
import { sanitizeMine, useMyThemes } from "@/lib/stores/themes";

const mineTheme = { ...QUIET, id: "mine", name: "Mine", author: "Sam Rivera" };

describe("themes saved for me", () => {
  it("are read back only as themes: a corrupt or hostile value is dropped, never rendered", () => {
    expect(sanitizeMine("not json at all")).toEqual({ mine: [], account: null });
    expect(sanitizeMine({ mine: "x", account: 7 })).toEqual({ mine: [], account: null });
    const read = sanitizeMine({ mine: [mineTheme, { ...mineTheme, id: "bad", light: { ...QUIET.light, paper: "url(x)" } }, null, 42, { ...mineTheme, id: "odd", switches: JSON.parse('{"constructor":"x"}') }], account: "acct-1" });
    expect(read.mine.map((theme) => theme.id)).toEqual(["mine"]);
    expect(read.account).toBe("acct-1");
  });

  it("belong to one account: another person signing in on this browser gets none of them", () => {
    const store = useMyThemes.getState();
    store.forget();
    store.adopt("sam");
    useMyThemes.getState().saveMine(mineTheme);
    useMyThemes.getState().adopt("sam");
    expect(useMyThemes.getState().mine.map((theme) => theme.id)).toEqual(["mine"]);
    useMyThemes.getState().adopt("robin");
    expect(useMyThemes.getState().mine).toEqual([]);
    expect(useMyThemes.getState().account).toBe("robin");
  });

  it("are forgotten on sign-out", () => {
    useMyThemes.getState().adopt("sam");
    useMyThemes.getState().saveMine(mineTheme);
    useMyThemes.getState().forget();
    expect(useMyThemes.getState()).toMatchObject({ mine: [], account: null });
  });
});
