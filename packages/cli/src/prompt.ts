/**
 * The two questions `galley new` asks in a terminal: which starter (a small
 * keyboard picker) and what to call the site. The picker's logic is plain
 * functions — a key in, the next state out — so it is tested without a
 * terminal; only `terminalPrompter` touches one.
 */
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

export interface PickerItem {
  /** "Caddow" */
  label: string;
  /** One line on what it is. */
  summary: string;
  /** What is inside: "20 sections · 6 page templates · 3 looks". */
  detail: string;
}

export interface Prompter {
  /** The index chosen, or null when the person cancelled. */
  choose(title: string, items: PickerItem[], initial?: number): Promise<number | null>;
  /** The answer (the default when they just press Enter), or null when they cancelled. */
  text(question: string, fallback: string): Promise<string | null>;
}

export interface Key {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
}

export type PickerStep = { index: number; done?: "chosen" | "cancelled" };

/** What one key press does to the picker. */
export function pickerKey(index: number, count: number, key: Key): PickerStep {
  const name = key.name ?? "";

  if ((key.ctrl && (name === "c" || name === "d")) || name === "escape" || name === "q") return { index, done: "cancelled" };
  if (name === "return" || name === "enter") return { index, done: "chosen" };
  if (name === "up" || name === "k" || (key.ctrl && name === "p")) return { index: (index - 1 + count) % count };
  if (name === "down" || name === "j" || name === "tab" || (key.ctrl && name === "n")) return { index: (index + 1) % count };
  const digit = Number.parseInt(key.sequence ?? "", 10);

  if (Number.isInteger(digit) && digit >= 1 && digit <= count && key.sequence?.length === 1) return { index: digit - 1, done: "chosen" };
  return { index };
}

const ESC = "\u001b[";

function style(on: boolean) {
  return {
    bold: (text: string) => (on ? `${ESC}1m${text}${ESC}22m` : text),
    dim: (text: string) => (on ? `${ESC}2m${text}${ESC}22m` : text),
  };
}

/** The picker as lines of text, the highlighted item marked with ›. */
export function renderPicker(title: string, items: PickerItem[], index: number, color = false): string[] {
  const { bold, dim } = style(color);
  const width = Math.max(...items.map((item) => item.label.length)) + 2;
  const lines = [title, dim("↑ ↓ to move, Enter to choose, Esc to stop"), ""];

  items.forEach((item, i) => {
    const here = i === index;
    const label = item.label.padEnd(width);

    lines.push(`${here ? "›" : " "} ${here ? bold(label) : label}${item.summary}`);
    lines.push(`  ${" ".repeat(width)}${dim(item.detail)}`);
  });
  return lines;
}

/** Questions on a real terminal: process.stdin and process.stdout, both TTYs. */
export function terminalPrompter(stdin: NodeJS.ReadStream = process.stdin, stdout: NodeJS.WriteStream = process.stdout, env: NodeJS.ProcessEnv = process.env): Prompter {
  const color = !env.NO_COLOR && env.TERM !== "dumb";

  return {
    choose(title, items, initial = 0) {
      return new Promise((resolve) => {
        let index = Math.min(Math.max(initial, 0), items.length - 1);
        let drawn = 0;
        const draw = () => {
          const lines = renderPicker(title, items, index, color);

          if (drawn) stdout.write(`${ESC}${drawn}A${ESC}0J`);
          stdout.write(`${lines.join("\n")}\n`);
          drawn = lines.length;
        };
        const finish = (result: number | null) => {
          stdin.off("keypress", onKey);
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          stdout.write(`${ESC}${drawn}A${ESC}0J${ESC}?25h`);
          stdout.write(result === null ? "" : `${title} ${style(color).bold(items[result]!.label)}\n`);
          resolve(result);
        };
        const onKey = (_text: string | undefined, key: Key | undefined) => {
          const step = pickerKey(index, items.length, key ?? {});

          index = step.index;
          if (step.done) finish(step.done === "chosen" ? index : null);
          else draw();
        };

        emitKeypressEvents(stdin);
        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.on("keypress", onKey);
        stdin.resume();
        stdout.write(`${ESC}?25l`);
        draw();
      });
    },

    async text(question, fallback) {
      const rl = createInterface({ input: stdin, output: stdout, terminal: true });
      let cancelled = false;

      rl.on("SIGINT", () => {
        cancelled = true;
        rl.close();
      });
      try {
        const answer = await rl.question(`${question} ${style(color).dim(`(${fallback})`)} `);

        return answer.trim() || fallback;
      } catch {
        // Closed by Ctrl+C or Ctrl+D.
        return null;
      } finally {
        rl.close();
        if (cancelled) stdout.write("\n");
      }
    },
  };
}
