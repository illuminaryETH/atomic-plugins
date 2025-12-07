import { useState, useEffect, useCallback, Fragment, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { WikiArticle, WikiCitation } from '../../stores/wiki';
import { CitationLink } from './CitationLink';
import { CitationPopover } from './CitationPopover';
import { SearchBar } from '../ui/SearchBar';
import { MarkdownImage } from '../ui/MarkdownImage';
import { useContentSearch } from '../../hooks';

interface WikiArticleContentProps {
  article: WikiArticle;
  citations: WikiCitation[];
  onViewAtom: (atomId: string) => void;
}

export function WikiArticleContent({ article, citations, onViewAtom }: WikiArticleContentProps) {
  const [activeCitation, setActiveCitation] = useState<WikiCitation | null>(null);
  const [anchorRect, setAnchorRect] = useState<{ top: number; left: number; bottom: number; width: number } | null>(null);

  // Content search
  const {
    isOpen: isSearchOpen,
    query: searchQuery,
    searchedQuery,
    currentIndex,
    totalMatches,
    setQuery: setSearchQuery,
    openSearch,
    closeSearch,
    goToNext,
    goToPrevious,
    processChildren: highlightChildren,
  } = useContentSearch(article.content);

  // Keyboard handler for Ctrl+F / Cmd+F
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        openSearch();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [openSearch]);

  // Create a map of citation index to citation object
  const citationMap = new Map(citations.map(c => [c.citation_index, c]));

  const handleCitationClick = (citation: WikiCitation, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setActiveCitation(citation);
    setAnchorRect({ top: rect.top, left: rect.left, bottom: rect.bottom, width: rect.width });
  };

  const handleClosePopover = () => {
    setActiveCitation(null);
    setAnchorRect(null);
  };

  // Process text to replace [N] patterns with CitationLink components
  // Returns array of strings and CitationLink elements (strings for highlighting, elements for citations)
  const processTextWithCitations = (text: string): (string | JSX.Element)[] => {
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[(\d+)\]/);
      if (match) {
        const index = parseInt(match[1], 10);
        const citation = citationMap.get(index);
        if (citation) {
          return (
            <CitationLink
              key={`citation-${i}-${index}`}
              index={index}
              onClick={(e) => handleCitationClick(citation, e.currentTarget)}
            />
          );
        }
      }
      // Return raw string so highlighting can be applied
      return part;
    });
  };

  // Process children recursively to handle citations and search highlighting in all text nodes
  const processChildren = useCallback((children: ReactNode): ReactNode => {
    if (typeof children === 'string') {
      // First process citations, then apply highlighting
      const withCitations = processTextWithCitations(children);
      if (isSearchOpen && searchQuery.trim()) {
        // Apply highlighting to string parts, keep citation elements as-is
        return withCitations.map((part, i) => {
          if (typeof part === 'string') {
            return <Fragment key={`hl-${i}`}>{highlightChildren(part)}</Fragment>;
          }
          // Citation link element - keep as is
          return part;
        });
      }
      // No search - wrap strings in fragments for valid React output
      return withCitations.map((part, i) =>
        typeof part === 'string' ? <Fragment key={`t-${i}`}>{part}</Fragment> : part
      );
    }
    if (Array.isArray(children)) {
      return children.map((child, i) => (
        <Fragment key={i}>{processChildren(child)}</Fragment>
      ));
    }
    return children;
  }, [isSearchOpen, searchQuery, highlightChildren]);

  // Custom components for react-markdown
  const components = {
    p: ({ children }: { children?: ReactNode }) => (
      <p>{processChildren(children)}</p>
    ),
    li: ({ children }: { children?: ReactNode }) => (
      <li>{processChildren(children)}</li>
    ),
    td: ({ children }: { children?: ReactNode }) => (
      <td>{processChildren(children)}</td>
    ),
    th: ({ children }: { children?: ReactNode }) => (
      <th>{processChildren(children)}</th>
    ),
    strong: ({ children }: { children?: ReactNode }) => (
      <strong>{processChildren(children)}</strong>
    ),
    em: ({ children }: { children?: ReactNode }) => (
      <em>{processChildren(children)}</em>
    ),
    del: ({ children }: { children?: ReactNode }) => (
      <del>{processChildren(children)}</del>
    ),
    h1: ({ children }: { children?: ReactNode }) => (
      <h1>{processChildren(children)}</h1>
    ),
    h2: ({ children }: { children?: ReactNode }) => (
      <h2>{processChildren(children)}</h2>
    ),
    h3: ({ children }: { children?: ReactNode }) => (
      <h3>{processChildren(children)}</h3>
    ),
    h4: ({ children }: { children?: ReactNode }) => (
      <h4>{processChildren(children)}</h4>
    ),
    h5: ({ children }: { children?: ReactNode }) => (
      <h5>{processChildren(children)}</h5>
    ),
    h6: ({ children }: { children?: ReactNode }) => (
      <h6>{processChildren(children)}</h6>
    ),
    blockquote: ({ children }: { children?: ReactNode }) => (
      <blockquote>{processChildren(children)}</blockquote>
    ),
    a: ({ href, children }: { href?: string; children?: ReactNode }) => (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {processChildren(children)}
      </a>
    ),
    code: ({ className, children }: { className?: string; children?: ReactNode }) => {
      const isBlock = className?.startsWith('language-');
      if (isBlock) {
        return <code className={className}>{processChildren(children)}</code>;
      }
      return <code>{processChildren(children)}</code>;
    },
    pre: ({ children }: { children?: ReactNode }) => (
      <pre>{children}</pre>
    ),
    img: ({ src, alt }: { src?: string; alt?: string }) => (
      <MarkdownImage src={src} alt={alt} />
    ),
  };

  return (
    <>
      <div className="wiki-content relative">
        {/* Search bar */}
        {isSearchOpen && (
          <SearchBar
            query={searchQuery}
            searchedQuery={searchedQuery}
            onQueryChange={setSearchQuery}
            currentIndex={currentIndex}
            totalMatches={totalMatches}
            onNext={goToNext}
            onPrevious={goToPrevious}
            onClose={closeSearch}
          />
        )}

        <div className="prose prose-invert prose-sm max-w-none px-6 py-4 prose-headings:text-[var(--color-text-primary)] prose-p:text-[var(--color-text-primary)] prose-a:text-[var(--color-accent)] prose-strong:text-[var(--color-text-primary)] prose-code:text-[var(--color-accent-light)] prose-code:bg-[var(--color-bg-card)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-[var(--color-bg-card)] prose-pre:border prose-pre:border-[var(--color-border)] prose-blockquote:border-l-[var(--color-accent)] prose-blockquote:text-[var(--color-text-secondary)] prose-li:text-[var(--color-text-primary)] prose-hr:border-[var(--color-border)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {article.content}
          </ReactMarkdown>
        </div>
      </div>

      {/* Citation popover */}
      {activeCitation && anchorRect && (
        <CitationPopover
          citation={activeCitation}
          anchorRect={anchorRect}
          onClose={handleClosePopover}
          onViewAtom={onViewAtom}
        />
      )}
    </>
  );
}

