/** Remove markdown and symbols that would be read out or look odd in the bubble
 *  ("**bold**", bullets, " - " used as a pause). Mirrors plain_text() in voice/elise_voice.py. */
export function plainText(text: string): string {
  return text
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, "")
    .replace(/[*_#`~>|]+/g, "")
    .replace(/(\d)\s*[-–—]\s*(\d)/g, "$1 to $2")
    .replace(/\s+[-–—]\s+/g, ", ")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/([:;,])\s*\./g, "$1")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}
