import { useEffect, useRef } from 'react';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import {
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';

import { ATOMIC_CODE_LANGUAGES } from '../../editor/codemirror/code-languages';
import {
  atomicEditorTheme,
  atomicMarkdownSyntax,
} from '../../editor/codemirror/atomic-theme';
import { inlinePreviewExtension } from '../../editor/codemirror/inline-preview';
import '../../styles/codemirror-inline-preview.css';

// Intentionally minimal while we iterate. No handle ref, no external-source
// sync, no search/toolbar wiring — those land once the core editing
// experience feels right.

export type AtomicCodeMirrorEditorProps = {
  documentId?: string;
  markdownSource: string;
  onMarkdownChange?: (markdown: string) => void;
};

export function AtomicCodeMirrorEditor({
  markdownSource,
  documentId,
  onMarkdownChange,
}: AtomicCodeMirrorEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onMarkdownChangeRef = useRef(onMarkdownChange);

  useEffect(() => {
    onMarkdownChangeRef.current = onMarkdownChange;
  }, [onMarkdownChange]);

  // Mount once per document identity; swapping documents tears down the
  // view so cursor/undo state from the previous doc doesn't leak.
  const editorIdentity = documentId ?? markdownSource;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const view = new EditorView({
      parent: root,
      state: EditorState.create({
        doc: markdownSource,
        extensions: [
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          rectangularSelection(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          markdown({ codeLanguages: ATOMIC_CODE_LANGUAGES }),
          atomicMarkdownSyntax,
          atomicEditorTheme,
          keymap.of([
            ...historyKeymap,
            ...markdownKeymap,
            indentWithTab,
            ...defaultKeymap,
          ]),
          inlinePreviewExtension,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            onMarkdownChangeRef.current?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorIdentity]);

  return <div ref={rootRef} className="atomic-cm-editor relative h-full w-full" />;
}
