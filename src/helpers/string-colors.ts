/**
 * Este archivo simplemente es para agregar colores a los strings de manera sencilla.
 */

const ANSI_RESET = '\u001B[0m';

const colorCodes = {
  green: '\u001B[32m',
  yellow: '\u001B[33m',
  blue: '\u001B[34m',
  red: '\u001B[31m',
  purple: '\u001B[35m',
} as const;

type ColorName = keyof typeof colorCodes;

declare global {
  interface String {
    readonly green: string;
    readonly yellow: string;
    readonly blue: string;
    readonly red: string;
    readonly purple: string;
  }
}

function addColorGetter(colorName: ColorName): void {
  Object.defineProperty(String.prototype, colorName, {
    configurable: true,
    get(): string {
      return `${colorCodes[colorName]}${String(this)}${ANSI_RESET}`;
    },
  });
}

for (const colorName of Object.keys(colorCodes) as ColorName[]) {
  addColorGetter(colorName);
}

export {};
