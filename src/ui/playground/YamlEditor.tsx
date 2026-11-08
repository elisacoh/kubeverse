import { useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { AlertTriangle, CheckCircle2, FilePlus2, FileCode2, PenLine, Rocket, X } from 'lucide-react';
import { THEME, diagnose, monaco, registerYamlHover, toMarkers } from '../../playground/editor/monaco';
import { judgeWhileTyping } from '../../playground/editor/typing';
import { docPath, pathAtOffset } from '../../playground/editor/yamlPath';
import { usePlayground } from '../../playground/store';
import type { Issue } from '../../playground/sim/manifest';

const OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 13,
  lineHeight: 20,
  tabSize: 2,
  insertSpaces: true,
  detectIndentation: false,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  renderWhitespace: 'boundary',
  guides: { indentation: true, highlightActiveIndentation: true },
  padding: { top: 10, bottom: 10 },
  fixedOverflowWidgets: true,
  wordBasedSuggestions: 'off',
  quickSuggestions: false,
  stickyScroll: { enabled: false },
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
};

/**
 * The YAML editor over the workspace files. Editing never touches the
 * cluster: only `kubectl apply` does (the Apply button types it in the
 * terminal for you).
 */
export default function YamlEditor({ protectedFiles }: { protectedFiles: readonly string[] }) {
  const files = usePlayground((s) => s.files);
  const active = usePlayground((s) => s.activeFile);
  const editFile = usePlayground((s) => s.editFile);
  const openFile = usePlayground((s) => s.openFile);
  const createFile = usePlayground((s) => s.createFile);
  const deleteFile = usePlayground((s) => s.deleteFile);
  const run = usePlayground((s) => s.run);
  const busy = usePlayground((s) => s.busy);
  const setField = usePlayground((s) => s.setField);
  const setCursor = usePlayground((s) => s.setCursor);
  const typingLine = usePlayground((s) => (s.cursor && s.cursor.file === active ? s.cursor.line : null));
  const [issues, setIssues] = useState<Issue[]>([]);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const names = Object.keys(files).sort();
  const text = active !== null ? (files[active] ?? '') : '';

  useEffect(() => {
    const t = setTimeout(() => {
      const found = judgeWhileTyping(text, typingLine, diagnose, (r) => r.filter((i) => i.level === 'syntax').map((i) => i.line));
      setIssues(found);
      const model = editorRef.current?.getModel();
      if (model) monaco.editor.setModelMarkers(model, 'kubeverse', toMarkers(model, found.filter((i) => !i.pending)));
    }, 250);
    return () => clearTimeout(t);
  }, [text, active, typingLine]);

  useEffect(() => () => setCursor(null), [setCursor]);

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    registerYamlHover();
    const reportCursor = () => {
      const pos = editor.getPosition();
      const file = activeRef.current;
      setCursor(editor.hasTextFocus() && pos && file !== null ? { file, line: pos.lineNumber } : null);
    };
    editor.onDidFocusEditorText(reportCursor);
    editor.onDidBlurEditorText(() => setCursor(null));
    let timer: ReturnType<typeof setTimeout> | null = null;
    editor.onDidChangeCursorPosition((e) => {
      reportCursor();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const model = editor.getModel();
        if (!model) return;
        const at = pathAtOffset(model.getValue(), model.getOffsetAt(e.position));
        setField(at ? { kind: at.kind, path: docPath(at.path) } : null);
      }, 120);
    });
  };

  const newFile = () => {
    const name = window.prompt('New file name', 'my-manifest.yaml')?.trim();
    if (!name) return;
    if (!/^[\w.-]+\.ya?ml$/.test(name)) {
      window.alert('Use a simple name ending in .yaml, like service.yaml.');
      return;
    }
    createFile(name);
  };

  const toWrite = [...new Set(issues.flatMap((i) => (i.pending ? [i.pending] : [])))];
  const problems = issues.filter((i) => !i.pending);
  const syntax = problems.filter((i) => i.level === 'syntax').length;
  const schema = problems.length - syntax;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a1230]">
      <div className="scrollbar-thin flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-white/[0.06] bg-[#0b1433] px-1.5 py-1">
        {names.map((n) => (
          <div
            key={n}
            className={`group flex shrink-0 items-center rounded-lg text-[12px] ${n === active ? 'bg-white/[0.08] text-white' : 'text-lavender/65 hover:bg-white/[0.04] hover:text-lavender'}`}
          >
            <button type="button" className="flex items-center gap-1.5 py-1 pl-2 pr-1.5 font-mono" onClick={() => openFile(n)}>
              <FileCode2 className="size-3.5 opacity-70" /> {n}
            </button>
            {!protectedFiles.includes(n) && (
              <button type="button" className="mr-1 rounded p-0.5 opacity-0 hover:bg-white/10 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => deleteFile(n)} aria-label={`Close ${n}`}>
                <X className="size-3" />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="hud-btn !px-1.5 !py-1" onClick={newFile} title="New file">
          <FilePlus2 className="size-3.5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {active === null ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-lavender/55">Files you write for a lesson appear here.</div>
        ) : (
          <Editor
            path={active}
            language="yaml"
            theme={THEME}
            value={text}
            onChange={(v) => editFile(active, v ?? '')}
            onMount={onMount}
            options={OPTIONS}
            loading={<div className="p-4 text-[12px] text-lavender/50">Loading editor…</div>}
          />
        )}
      </div>

      {active !== null && (
        <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-2.5 py-1.5 text-[11.5px]">
          {problems.length > 0 ? (
            <button
              type="button"
              className="flex min-w-0 items-center gap-1 text-left text-warn hover:underline"
              onClick={() => {
                const line = problems[0]?.line;
                if (line && editorRef.current) {
                  editorRef.current.revealLineInCenter(line);
                  editorRef.current.setPosition({ lineNumber: line, column: 1 });
                  editorRef.current.focus();
                }
              }}
              title={problems.map((i) => `${i.line ? `line ${i.line}: ` : ''}${i.message}`).join('\n')}
            >
              <AlertTriangle className="size-3.5 shrink-0" />
              <span className="truncate">
                {syntax ? `${syntax} syntax error${syntax > 1 ? 's' : ''}` : `${schema} schema issue${schema > 1 ? 's' : ''}`}
                {problems[0]?.line ? ` · line ${problems[0].line}` : ''}: {problems[0]?.message}
              </span>
            </button>
          ) : toWrite.length > 0 ? (
            <span className="flex min-w-0 items-center gap-1 text-lavender/60" title={toWrite.join('\n')}>
              <PenLine className="size-3.5 shrink-0" />
              <span className="truncate">
                In progress · still to write: <span className="font-mono">{toWrite.join(', ')}</span>
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-ok/90">
              <CheckCircle2 className="size-3.5" /> Valid YAML
            </span>
          )}
          <span className="ml-auto hidden shrink-0 text-lavender/40 xl:inline">Edits stay local until applied</span>
          <button type="button" className="primary-btn shrink-0 !px-2.5 !py-1" disabled={busy} onClick={() => run(`kubectl apply -f ${active}`)} title={`Runs: kubectl apply -f ${active}`}>
            <Rocket className="size-3.5" /> Apply
          </button>
        </div>
      )}
    </div>
  );
}
