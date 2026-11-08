/**
 * Monaco, bundled locally (no CDN) with only the editor core and YAML
 * highlighting. Field documentation and validation come from the
 * Playground's own schema registry.
 */
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/languages/definitions/yaml/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { loader } from '@monaco-editor/react';
import { parseYaml, validateObject, type Issue } from '../sim/manifest';
import { describeType, lookupField } from '../sim/schema';
import { docPath, pathAtOffset } from './yamlPath';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

export const THEME = 'kubeverse';

monaco.editor.defineTheme(THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'type', foreground: '6fe3ff' },
    { token: 'string', foreground: 'ffd38a' },
    { token: 'number', foreground: 'b7f59a' },
    { token: 'keyword', foreground: 'c6b6ff' },
    { token: 'comment', foreground: '7d86b8', fontStyle: 'italic' },
  ],
  colors: {
    'editor.background': '#0a1230',
    'editor.lineHighlightBackground': '#16224d',
    'editorLineNumber.foreground': '#4a5590',
    'editorLineNumber.activeForeground': '#b3a4ff',
    'editorIndentGuide.background1': '#1e2a5a',
    'editorIndentGuide.activeBackground1': '#3fd4c0',
    'editor.selectionBackground': '#2c3a6e',
    'editorCursor.foreground': '#3fd4c0',
    'editorHoverWidget.background': '#0e1738',
    'editorHoverWidget.border': '#2c3a6e',
  },
});

let hoverRegistered = false;

/** Hover any key or value to read what the field means, in the context of the document's kind. */
export const registerYamlHover = () => {
  if (hoverRegistered) return;
  hoverRegistered = true;
  monaco.languages.registerHoverProvider('yaml', {
    provideHover(model, position) {
      const at = pathAtOffset(model.getValue(), model.getOffsetAt(position));
      if (!at?.kind) return null;
      const found = lookupField(at.kind, at.path);
      if (!found) return null;
      const d = found.field.doc;
      const start = model.getPositionAt(at.range[0]);
      const end = model.getPositionAt(at.range[1]);
      return {
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        contents: [
          { value: `**${found.key}** \`${describeType(found.field.node)}\`${found.field.required ? ' · required' : ''} · in ${found.parentType}` },
          { value: [d.summary, d.why && `**Why:** ${d.why}`, d.values && `**Values:** ${d.values}`, d.how && `**How Kubernetes uses it:** ${d.how}`].filter(Boolean).join('\n\n') },
          { value: `_${at.kind} · ${docPath(at.path)}_` },
        ],
      };
    },
  });
};

/** Documents that declare `kind` or `apiVersion` are Kubernetes manifests; anything else is plain YAML practice. */
const isManifest = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v) && ('kind' in v || 'apiVersion' in v);

/** Syntax and schema problems as editor markers. Objectives are shown in the lesson panel instead. */
export const diagnose = (text: string): Issue[] => {
  const { docs, issues } = parseYaml(text);
  if (issues.length) return issues;
  return docs.flatMap((d) => (isManifest(d.value) ? validateObject(d.value, d.lineOf).issues : []));
};

export const toMarkers = (model: monaco.editor.ITextModel, issues: Issue[]): monaco.editor.IMarkerData[] =>
  issues.map((i) => {
    const line = Math.min(Math.max(i.line ?? 1, 1), model.getLineCount());
    const text = model.getLineContent(line);
    const first = text.length - text.trimStart().length + 1;
    return {
      severity: i.level === 'syntax' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      message: `${i.level === 'syntax' ? 'YAML syntax' : 'Kubernetes schema'}: ${i.message}${i.hint ? `\n${i.hint}` : ''}`,
      startLineNumber: line,
      startColumn: first,
      endLineNumber: line,
      endColumn: Math.max(model.getLineMaxColumn(line), first + 1),
    };
  });

export { monaco };
