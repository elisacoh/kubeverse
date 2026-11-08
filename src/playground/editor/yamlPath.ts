import { isMap, isPair, isScalar, isSeq, parseAllDocuments, type Node } from 'yaml';
import { asKind } from '../sim/schema';
import type { Kind } from '../sim/types';

export interface PathAt {
  /** Keys and list indexes from the document root, e.g. ['spec', 'containers', 0, 'image']. */
  path: (string | number)[];
  /** The `kind` of the document the offset is in, if recognised. */
  kind: Kind | null;
  /** Source range of the key under the offset. */
  range: [number, number];
}

const within = (node: { range?: [number, number, number] | null } | null | undefined, offset: number) =>
  !!node?.range && offset >= node.range[0] && offset <= node.range[1];

/** Innermost mapping key at (or whose value contains) the offset. */
const walk = (node: unknown, offset: number, path: (string | number)[]): { path: (string | number)[]; range: [number, number] } | null => {
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isPair(pair) || !isScalar(pair.key)) continue;
      const key = String(pair.key.value);
      const keyNode = pair.key as Node;
      const value = pair.value as Node | null;
      const here = [...path, key];
      if (within(keyNode, offset)) return { path: here, range: [keyNode.range![0], keyNode.range![1]] };
      if (value && within(value, offset)) {
        if (isMap(value) || isSeq(value)) {
          const deeper = walk(value, offset, here);
          if (deeper) return deeper;
        }
        return { path: here, range: [keyNode.range![0], keyNode.range![1]] };
      }
    }
    return null;
  }
  if (isSeq(node)) {
    for (let i = 0; i < node.items.length; i++) {
      const item = node.items[i] as Node;
      if (within(item, offset)) return walk(item, offset, [...path, i]);
    }
  }
  return null;
};

/** The YAML field at a character offset, with its document's kind, for contextual docs. */
export const pathAtOffset = (text: string, offset: number): PathAt | null => {
  const docs = parseAllDocuments(text, { keepSourceTokens: false });
  for (const doc of Array.isArray(docs) ? docs : []) {
    const contents = doc.contents as Node | null;
    if (!contents?.range || offset < contents.range[0] || offset > contents.range[2]) continue;
    const found = walk(contents, offset, []);
    if (!found) return null;
    const kindNode = isMap(contents) ? contents.get('kind') : undefined;
    return { ...found, kind: asKind(kindNode) };
  }
  return null;
};

/** Dotted path without list indexes, as field docs are keyed. */
export const docPath = (path: readonly (string | number)[]) => path.filter((s) => typeof s === 'string').join('.');
