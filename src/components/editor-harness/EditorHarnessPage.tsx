import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AtomicCodeMirrorEditor } from '@atomic/editor';
import '@atomic/editor/styles.css';
import { useFont, useTheme } from '../../hooks';
import { useSettingsStore } from '../../stores/settings';
import { openExternalUrl } from '../../lib/platform';
import { MinimalCodeMirrorEditor } from './MinimalCodeMirrorEditor';
import { NoPreviewCodeMirrorEditor } from './NoPreviewCodeMirrorEditor';
import { ScrollDiagnostics } from './ScrollDiagnostics';

type EditorFlavor = 'atomic' | 'no-preview' | 'minimal';
const EDITOR_FLAVORS: EditorFlavor[] = ['atomic', 'no-preview', 'minimal'];
import {
  CODE_BLOCKS_MODES,
  LISTS_MODES,
  SAMPLE_MODES,
  SAMPLE_SIZES,
  SEPARATORS_MODES,
  TABLES_MODES,
  generateSampleMarkdown,
  type CodeBlocksMode,
  type ListsMode,
  type SampleMode,
  type SampleSize,
  type SeparatorsMode,
  type TablesMode,
} from './sample-content';

function formatBytes(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / (1024 * 1024)).toFixed(2)} MB`;
}

export function EditorHarnessPage() {
  useTheme();
  useFont();

  // The theme/font hooks read from the settings store, but the store is
  // lazy — it's only populated when the SettingsModal opens. The
  // harness lives outside the normal Layout, so without this fetch it
  // would always show the built-in defaults regardless of what the
  // user selected.
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  useEffect(() => {
    fetchSettings().catch(() => {
      // Transport may be disconnected (web mode without saved server
      // config). The defaults from useFont/useTheme are fine in that
      // case — no need to surface the failure.
    });
  }, [fetchSettings]);

  const [size, setSize] = useState<SampleSize>('100 pages');
  const [mode, setMode] = useState<SampleMode>('with images');
  const [separators, setSeparators] = useState<SeparatorsMode>(
    'with separators',
  );
  const [tables, setTables] = useState<TablesMode>('with tables');
  const [lists, setLists] = useState<ListsMode>('with lists');
  const [codeBlocks, setCodeBlocks] = useState<CodeBlocksMode>(
    'with code blocks',
  );
  const [flavor, setFlavor] = useState<EditorFlavor>('atomic');
  const markdownSource = useMemo(
    () =>
      generateSampleMarkdown(size, {
        mode,
        separators,
        tables,
        lists,
        codeBlocks,
      }),
    [size, mode, separators, tables, lists, codeBlocks],
  );

  const stats = useMemo(() => {
    let lines = 1;
    for (let i = 0; i < markdownSource.length; i++) {
      if (markdownSource.charCodeAt(i) === 10) lines++;
    }
    return { chars: markdownSource.length, lines };
  }, [markdownSource]);

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg-main)] text-[var(--color-text-primary)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-panel)] px-4 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-wide">Editor Harness</span>
            <Link
              to="/"
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent-light)]"
            >
              ← back to app
            </Link>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">size:</span>
            {SAMPLE_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                className={
                  'rounded border px-2 py-1 text-xs transition-colors ' +
                  (size === s
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-alpha)] text-[var(--color-text-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]')
                }
              >
                {s}
              </button>
            ))}
          </div>

          {/* Mode toggle — isolate image-related layout effects from
              the rest of the sample (momentum-scroll diagnostics,
              image widget regressions, etc.). */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">images:</span>
            {SAMPLE_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={
                  'rounded border px-2 py-1 text-xs transition-colors ' +
                  (mode === m
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-alpha)] text-[var(--color-text-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]')
                }
              >
                {m === 'with images' ? 'on' : 'off'}
              </button>
            ))}
          </div>

          {/* Separators toggle — with `on`, an HR drops between every
              section so a long scroll hits many `---` lines. Flip
              `off` to remove every HR (including the showcase one)
              and see whether iOS momentum halts correlate with HR
              boundaries specifically. */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">separators:</span>
            {SEPARATORS_MODES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeparators(s)}
                className={
                  'rounded border px-2 py-1 text-xs transition-colors ' +
                  (separators === s
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-alpha)] text-[var(--color-text-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]')
                }
              >
                {s === 'with separators' ? 'on' : 'off'}
              </button>
            ))}
          </div>

          {/* Tables toggle — tables are block-replace widgets with
              their own DOM tree; they're the next most likely
              suspect after images for scroll-height churn. Flip
              `off` to strip the showcase table and every random
              per-section table (replaced 1:1 with a paragraph to
              preserve overall block density). */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">tables:</span>
            {TABLES_MODES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTables(t)}
                className={
                  'rounded border px-2 py-1 text-xs transition-colors ' +
                  (tables === t
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-alpha)] text-[var(--color-text-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]')
                }
              >
                {t === 'with tables' ? 'on' : 'off'}
              </button>
            ))}
          </div>

          {/* Lists toggle — both bullet lists and task lists. Lists
              involve the most per-line decoration work in
              inline-preview: BulletWidget for `- ` / `* `,
              TaskCheckboxWidget for `[ ]` / `[x]`, depth-based
              line padding, plus the task-done line class. Flip
              `off` to see whether the scroll halt tracks with lists
              specifically. */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">lists:</span>
            {LISTS_MODES.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLists(l)}
                className={
                  'rounded border px-2 py-1 text-xs transition-colors ' +
                  (lists === l
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-alpha)] text-[var(--color-text-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]')
                }
              >
                {l === 'with lists' ? 'on' : 'off'}
              </button>
            ))}
          </div>

          {/* Code blocks toggle — fenced code adds a whole-line
              `cm-atomic-fenced-code` class with a distinct
              background, monospace font, and padding. The class
              change can alter line-wrap metrics and force a
              re-measure during scroll. Flip `off` to rule code
              blocks in or out. */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">code:</span>
            {CODE_BLOCKS_MODES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCodeBlocks(c)}
                className={
                  'rounded border px-2 py-1 text-xs transition-colors ' +
                  (codeBlocks === c
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-alpha)] text-[var(--color-text-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]')
                }
              >
                {c === 'with code blocks' ? 'on' : 'off'}
              </button>
            ))}
          </div>

          {/* Editor flavor — `atomic` is the full @atomic/editor
              build (inline preview, tables, images, theme, search,
              etc.). `minimal` is stock CM6 + lang-markdown, used to
              isolate whether scroll halts live in our extensions or
              in CM6 core. */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">editor:</span>
            {EDITOR_FLAVORS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFlavor(f)}
                className={
                  'rounded border px-2 py-1 text-xs transition-colors ' +
                  (flavor === f
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-alpha)] text-[var(--color-text-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]')
                }
              >
                {f}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-4 text-xs text-[var(--color-text-secondary)]">
            <span>
              <span className="font-mono text-[var(--color-text-primary)]">
                {stats.lines.toLocaleString()}
              </span>{' '}
              lines
            </span>
            <span>
              <span className="font-mono text-[var(--color-text-primary)]">
                {formatBytes(stats.chars)}
              </span>
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <div className="mx-auto h-full max-w-6xl px-4 py-4">
          <div className="h-full overflow-hidden rounded-lg border border-[var(--color-border)]">
            {flavor === 'atomic' ? (
              <AtomicCodeMirrorEditor
                key={`atomic|${size}|${mode}|${separators}|${tables}|${lists}|${codeBlocks}`}
                documentId={`harness-${size}-${mode}-${separators}-${tables}-${lists}-${codeBlocks}`}
                markdownSource={markdownSource}
                onLinkClick={(url) => {
                  void openExternalUrl(url);
                }}
              />
            ) : flavor === 'no-preview' ? (
              <NoPreviewCodeMirrorEditor
                key={`no-preview|${size}|${mode}|${separators}|${tables}|${lists}|${codeBlocks}`}
                documentId={`no-preview-harness-${size}-${mode}-${separators}-${tables}-${lists}-${codeBlocks}`}
                markdownSource={markdownSource}
              />
            ) : (
              <MinimalCodeMirrorEditor
                key={`minimal|${size}|${mode}|${separators}|${tables}|${lists}|${codeBlocks}`}
                documentId={`minimal-harness-${size}-${mode}-${separators}-${tables}-${lists}-${codeBlocks}`}
                markdownSource={markdownSource}
              />
            )}
          </div>
        </div>
      </main>

      <ScrollDiagnostics />
    </div>
  );
}
