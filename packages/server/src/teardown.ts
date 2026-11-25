/**
 * Undoing a start that failed: every step is tried whatever the one before
 * did, so one that fails (or never ends) can't leave the rest undone, and
 * none of their failures replaces the error the start failed with.
 */

/** How long one step of undoing a failed start may take before the next is tried without it. */
export const UNDO_STEP_MS = 10_000;

export interface UndoStep {
  /** What is being undone, for the log: "closing the site". */
  what: string;
  run(): unknown;
}

/** Runs each step in order. A step that throws, rejects or doesn't end in `stepMs` is said in one line, and the next is tried. */
export async function undoEach(steps: readonly UndoStep[], say: (line: string) => void, stepMs: number = UNDO_STEP_MS): Promise<void> {
  for (const step of steps) {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        Promise.resolve().then(() => step.run()),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("it took too long")), stepMs);
          timer.unref?.();
        }),
      ]);
    } catch (error) {
      say(`While undoing a start that failed, ${step.what} didn't work: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
