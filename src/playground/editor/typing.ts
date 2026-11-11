/** Replaces one line (1-based) with an empty one, so every other line keeps its number. */
export const blankLine = (text: string, line: number) =>
  text
    .split('\n')
    .map((l, i) => (i === line - 1 ? '' : l))
    .join('\n');

/** A line holding only a word, like `containers` before its colon. */
const halfKey = (text: string, line: number) => /^\s*[\w.-]+\s*$/.test(text.split('\n')[line - 1] ?? '');

/**
 * A key typed halfway (`age`, before its colon) is a syntax error for a moment,
 * or, indented under `spec:`, turns `spec` into the text "containers".
 * While the line being typed is a lone word, or holds every syntax error,
 * judge the text without that line; the error shows once the learner moves on.
 */
export const judgeWhileTyping = <R>(text: string, line: number | null, judge: (text: string) => R, syntaxLines: (r: R) => readonly (number | undefined)[]): R => {
  if (line !== null && halfKey(text, line)) return judge(blankLine(text, line));
  const r = judge(text);
  if (line === null) return r;
  const lines = syntaxLines(r);
  return lines.length > 0 && lines.every((l) => l === line) ? judge(blankLine(text, line)) : r;
};
