import { tolerateClosedPipe } from "./io";
import { main } from "./main";

// Before any command writes: a reader that stops early (`| head`) ends the run quietly, for every command.
tolerateClosedPipe(process.stdout);
tolerateClosedPipe(process.stderr);

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  }
);
