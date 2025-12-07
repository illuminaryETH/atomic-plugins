import { useState, useCallback, useEffect, useRef, ReactNode, Fragment } from 'react';

interface UseContentSearchReturn {
  isOpen: boolean;
  query: string;
  searchedQuery: string; // The query that totalMatches corresponds to
  currentIndex: number;
  totalMatches: number;
  setQuery: (q: string) => void;
  openSearch: () => void;
  closeSearch: () => void;
  goToNext: () => void;
  goToPrevious: () => void;
  highlightText: (text: string) => ReactNode;
  processChildren: (children: ReactNode) => ReactNode;
}

// Escape special regex characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Global counter for unique instance IDs
let instanceCounter = 0;

export function useContentSearch(_content: string): UseContentSearchReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchedQuery, setSearchedQuery] = useState(''); // Query that totalMatches corresponds to
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const [instanceId] = useState(() => `search-${++instanceCounter}`);

  // Use ref to track the current index for scrolling (avoids stale closure issues)
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;


  // Reset currentIndex when total matches changes
  useEffect(() => {
    if (totalMatches === 0) {
      setCurrentIndex(0);
    } else if (currentIndex >= totalMatches) {
      setCurrentIndex(totalMatches - 1);
    }
  }, [totalMatches, currentIndex]);

  // Get all matches in DOM order (top to bottom)
  const getMatchesInOrder = useCallback(() => {
    const marks = document.querySelectorAll(`[data-search-id="${instanceId}"]`);
    // Convert to array - querySelectorAll already returns in DOM order
    return Array.from(marks);
  }, [instanceId]);

  // Scroll to a specific match by DOM order index
  const scrollToMatch = useCallback((targetIndex: number) => {
    requestAnimationFrame(() => {
      const matches = getMatchesInOrder();
      const el = matches[targetIndex];
      if (el) {
        // Update visual indicator - remove from all, add to current
        matches.forEach((m, i) => {
          if (i === targetIndex) {
            m.setAttribute('data-current', 'true');
          } else {
            m.removeAttribute('data-current');
          }
        });
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    });
  }, [getMatchesInOrder]);

  const openSearch = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setSearchedQuery('');
    setCurrentIndex(0);
    setTotalMatches(0);
  }, []);

  const goToNext = useCallback(() => {
    // Count actual matches in DOM to get accurate total
    const matches = document.querySelectorAll(`[data-search-id="${instanceId}"]`);
    const count = matches.length;
    if (count > 0) {
      const nextIndex = (currentIndexRef.current + 1) % count;
      setCurrentIndex(nextIndex);
      setTotalMatches(count);
      scrollToMatch(nextIndex);
    }
  }, [instanceId, scrollToMatch]);

  const goToPrevious = useCallback(() => {
    // Count actual matches in DOM to get accurate total
    const matches = document.querySelectorAll(`[data-search-id="${instanceId}"]`);
    const count = matches.length;
    if (count > 0) {
      const nextIndex = (currentIndexRef.current - 1 + count) % count;
      setCurrentIndex(nextIndex);
      setTotalMatches(count);
      scrollToMatch(nextIndex);
    }
  }, [instanceId, scrollToMatch]);

  // Update match count and scroll to first match when query changes
  useEffect(() => {
    if (isOpen && query.trim()) {
      // Wait for DOM to update, then count matches
      requestAnimationFrame(() => {
        const matches = document.querySelectorAll(`[data-search-id="${instanceId}"]`);
        setTotalMatches(matches.length);
        setSearchedQuery(query); // Mark this query as searched
        if (matches.length > 0) {
          setCurrentIndex(0);
          scrollToMatch(0);
        } else {
          setCurrentIndex(0);
        }
      });
    } else if (isOpen && !query.trim()) {
      // Query cleared - reset counts
      setTotalMatches(0);
      setSearchedQuery('');
      setCurrentIndex(0);
    }
  }, [query, isOpen, instanceId, scrollToMatch]);

  // Highlight text with search matches
  const highlightText = useCallback(
    (text: string): ReactNode => {
      if (!query.trim() || !text) {
        return text;
      }

      const escapedQuery = escapeRegex(query);
      const regex = new RegExp(`(${escapedQuery})`, 'gi');
      const parts = text.split(regex);

      if (parts.length === 1) {
        return text;
      }

      return parts.map((part, i) => {
        if (part.toLowerCase() === query.toLowerCase()) {
          return (
            <mark
              key={`${instanceId}-${i}`}
              className="search-highlight"
              data-search-id={instanceId}
            >
              {part}
            </mark>
          );
        }
        return <Fragment key={`text-${i}`}>{part}</Fragment>;
      });
    },
    [query, instanceId]
  );

  // Process ReactNode children recursively to apply highlighting
  const processChildren = useCallback(
    (children: ReactNode): ReactNode => {
      if (typeof children === 'string') {
        return highlightText(children);
      }
      if (Array.isArray(children)) {
        return children.map((child, i) => (
          <Fragment key={i}>{processChildren(child)}</Fragment>
        ));
      }
      return children;
    },
    [highlightText]
  );

  return {
    isOpen,
    query,
    searchedQuery,
    currentIndex,
    totalMatches,
    setQuery,
    openSearch,
    closeSearch,
    goToNext,
    goToPrevious,
    highlightText,
    processChildren,
  };
}
