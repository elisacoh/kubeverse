/** Replaces one line (1-based) with an empty one, so every other line keeps its number. */
export const blankLine = (text: string, line: number) =>
  text
    .split('\n')
    .map((l, i) => (i === line - 1 ? '' : l))
    .join('\n');

/**
 * A key typed halfway (`age`, before its colon) is a syntax error for a moment.
 * While every syntax error sits on the line being typed, judge the text
 * without that line; the error shows once the learner moves on.
 */
export const judgeWhileTyping = <R>(text: string, line: number | null, judge: (text: string) => R, syntaxLines: (r: R) => readonly (number | undefined)[]): R => {
  const r = judge(text);
  if (line === null) return r;
  const lines = syntaxLines(r);
  return lines.length > 0 && lines.every((l) => l === line) ? judge(blankLine(text, line)) : r;
};
