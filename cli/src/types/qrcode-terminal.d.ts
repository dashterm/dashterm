declare module 'qrcode-terminal' {
  interface GenerateOptions {
    small?: boolean;
  }
  function generate(
    input: string,
    options?: GenerateOptions,
    callback?: (qrcode: string) => void,
  ): void;
  function setErrorLevel(level: 'L' | 'M' | 'Q' | 'H'): void;
  const _default: { generate: typeof generate; setErrorLevel: typeof setErrorLevel };
  export default _default;
}
