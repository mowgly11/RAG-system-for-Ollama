import { createInterface } from "readline";

const readline = createInterface({ input: process.stdin, output: process.stdout });

export default function input(prompt: string) {
  return new Promise((callbackFunction, errorFunction) => {
    readline.question(
      prompt,
      (userInput) => {
        callbackFunction(userInput);
      },
      () => {
        errorFunction();
      }
    );
  });
}

export function loader() {
  let charList: string[] = ['—', '/','|', '\\'];
  let i = 0;
  let loader = setInterval(() => {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`${charList[i]}`);

    if(charList.length - 1 <= i) {
      i = 0;
    } else {
      i++;
    };
  }, 200);

  return loader;
}

export function stopLoader(loader: NodeJS.Timeout) {
  clearInterval(loader);
  process.stdout.clearLine(0);
  process.stdout.cursorTo(0);
}