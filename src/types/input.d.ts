declare module 'input' {
  const input: { text(message: string): Promise<string> };
  export = input;
}
