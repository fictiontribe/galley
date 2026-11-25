/**
 * A caller that no longer stands for the person (install/caller.ts
 * `lapsed`): the request was answered, or the sign-in ended. Guarded work is
 * then refused in the sentence the caller gives, whether or not the server
 * requires a caller for guarded work at all: a server that is stopping has
 * already dropped that switch. A caller without `lapsed` is as it always was.
 */
import { afterEach, describe, expect, it } from "vitest";
import { GalleyError } from "../../src/errors";
import { callerMay, callerRefusal, OUTLIVED_REFUSAL, requireCallerForGuardedWork, requireLevel, SIGN_IN_ENDED_REFUSAL, withCaller, type Caller } from "../../src/install/caller";
import { ROLE_REFUSAL } from "../../src/install/route-access";

afterEach(() => requireCallerForGuardedWork(false));

const owner: Caller = { accountId: "owner-1", role: "owner" };
const refusal = (work: () => void): string | null => {
  try {
    work();
    return null;
  } catch (error) {
    if (error instanceof GalleyError && error.code === "forbidden") return error.message;
    throw error;
  }
};

describe("a caller that no longer stands", () => {
  it.each([false, true])("is refused guarded work in its own sentence, whether or not the server requires a caller (%s)", (required) => {
    requireCallerForGuardedWork(required);
    let why: string | null = null;
    const caller: Caller = { ...owner, lapsed: () => why };

    withCaller(caller, () => {
      // While it stands: an owner, allowed everything.
      expect(callerMay("manage")).toBe(true);
      expect(refusal(() => requireLevel("publish"))).toBeNull();
      for (const sentence of [OUTLIVED_REFUSAL, SIGN_IN_ENDED_REFUSAL]) {
        why = sentence;
        for (const level of ["edit", "publish", "manage"] as const) {
          expect(callerMay(level), level).toBe(false);
          expect(refusal(() => requireLevel(level)), level).toBe(sentence);
        }
        // Whatever sentence the check would otherwise have used.
        expect(callerRefusal("Something else.")).toBe(sentence);
      }
      // Standing again (only a test does this): allowed again, so the answer is read at each check.
      why = null;
      expect(callerMay("manage")).toBe(true);
    });
  });

  it("follows the work the request started, as the caller itself does", async () => {
    let answered = false;
    const caller: Caller = { ...owner, lapsed: () => (answered ? OUTLIVED_REFUSAL : null) };
    const later = withCaller(caller, () => new Promise<string | null>((resolve) => setTimeout(() => resolve(refusal(() => requireLevel("publish"))), 20)));

    answered = true;
    expect(await later).toBe(OUTLIVED_REFUSAL);
  });

  it("changes nothing for a caller without it: a role below the level, a role taken away, and the work a request starts", async () => {
    requireCallerForGuardedWork(true);
    let role: "owner" | "contributor" | null = "owner";
    const caller: Caller = { accountId: "someone", role: "owner", current: () => role };

    await withCaller(caller, async () => {
      expect(refusal(() => requireLevel("manage"))).toBeNull();
      role = "contributor";
      expect(refusal(() => requireLevel("manage"))).toBe(ROLE_REFUSAL);
      role = null;
      expect(refusal(() => requireLevel("edit"))).toBe(ROLE_REFUSAL);
      role = "owner";
      // Work that outlives the request keeps the person's access to the end, as an assistant turn or a job must.
      expect(await new Promise<string | null>((resolve) => setTimeout(() => resolve(refusal(() => requireLevel("publish"))), 10))).toBeNull();
    });
    withCaller({ accountId: "c", role: "contributor" }, () => expect(refusal(() => requireLevel("publish"))).toBe(ROLE_REFUSAL));
  });
});
