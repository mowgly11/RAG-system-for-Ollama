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