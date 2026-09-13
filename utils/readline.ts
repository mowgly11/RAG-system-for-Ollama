import { createInterface } from "node:readline";

const readline = createInterface({ input: process.stdin, output: process.stdout });

export default function input(prompt: string): Promise<string> {
  // readline.question takes the callback as its second argument. Passing a
  // third function meant the rejection path could never fire.
  return new Promise(resolve => readline.question(prompt, resolve));
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
