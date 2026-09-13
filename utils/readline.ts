import { createInterface } from "node:readline";

const readline = createInterface({ input: process.stdin, output: process.stdout });

let closed = false;

readline.on("close", () => { closed = true; });

/**
 * Resolves with one line, or with an empty string once input has ended.
 *
 * End of input is Ctrl+D, or a piped stream running out. Asking a closed
 * interface for another line throws ERR_USE_AFTER_CLOSE, so callers used to
 * die with a stack trace instead of stopping. Callers already treat an empty
 * line as "stop", so end of input now follows the same path.
 */
export default function input(prompt: string): Promise<string> {
  if (closed) return Promise.resolve("");

  // readline.question takes the callback as its second argument. Passing a
  // third function meant the rejection path could never fire.
  return new Promise(resolve => {
    const onClose = () => resolve("");

    readline.once("close", onClose);

    readline.question(prompt, answer => {
      readline.removeListener("close", onClose);
      resolve(answer);
    });
  });
}

export function closeInput(): void {
  readline.close();
}

/** clearLine and cursorTo only exist on a TTY, so piped output must not crash. */
function canRedraw(): boolean {
  return process.stdout.isTTY === true && typeof process.stdout.clearLine === "function";
}

export function loader(): NodeJS.Timeout | null {
  if (!canRedraw()) return null;

  const charList: string[] = ['-', '/', '|', '\\'];
  let i = 0;

  return setInterval(() => {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`${charList[i]}`);

    i = charList.length - 1 <= i ? 0 : i + 1;
  }, 200);
}

export function stopLoader(loader: NodeJS.Timeout | null): void {
  if (!loader) return;

  clearInterval(loader);

  if (!canRedraw()) return;

  process.stdout.clearLine(0);
  process.stdout.cursorTo(0);
}
