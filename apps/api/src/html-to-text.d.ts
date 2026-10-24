declare module 'html-to-text' {
  export function convert(
    html: string,
    options?: {
      wordwrap?: false | number;
      limits?: { maxInputLength?: number; maxOutputLength?: number };
      selectors?: Array<{ selector: string; format: string }>;
    },
  ): string;
}
