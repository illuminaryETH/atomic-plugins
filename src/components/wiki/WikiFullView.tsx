import { useEffect, useRef, useState } from 'react';
import { useWikiStore } from '../../stores/wiki';
import { useUIStore } from '../../stores/ui';
import { WikiArticlesList } from './WikiArticlesList';
import { WikiEmptyState } from './WikiEmptyState';
import { WikiGenerating } from './WikiGenerating';
import { WikiArticleContent } from './WikiArticleContent';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

export function WikiFullView() {
  const view = useWikiStore(s => s.view);
  const currentTagId = useWikiStore(s => s.currentTagId);
  const currentTagName = useWikiStore(s => s.currentTagName);
  const currentArticle = useWikiStore(s => s.currentArticle);
  const articleStatus = useWikiStore(s => s.articleStatus);
  const relatedTags = useWikiStore(s => s.relatedTags);
  const wikiLinks = useWikiStore(s => s.wikiLinks);
  const isLoading = useWikiStore(s => s.isLoading);
  const isGenerating = useWikiStore(s => s.isGenerating);
  const isUpdating = useWikiStore(s => s.isUpdating);
  const error = useWikiStore(s => s.error);
  const fetchAllArticles = useWikiStore(s => s.fetchAllArticles);
  const generateArticle = useWikiStore(s => s.generateArticle);
  const openArticle = useWikiStore(s => s.openArticle);
  const goBack = useWikiStore(s => s.goBack);
  const clearError = useWikiStore(s => s.clearError);

  const selectedVersion = useWikiStore(s => s.selectedVersion);

  const reset = useWikiStore(s => s.reset);

  const openDrawer = useUIStore(s => s.openDrawer);

  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    fetchAllArticles();
  }, [fetchAllArticles]);

  // Clean up wiki store state on unmount
  useEffect(() => {
    return () => { reset(); };
  }, [reset]);

  const handleGenerate = () => {
    if (currentTagId && currentTagName) {
      generateArticle(currentTagId, currentTagName);
    }
  };

  const handleViewAtom = (atomId: string) => {
    openDrawer('viewer', atomId);
  };

  const renderArticleContent = () => {
    if (view === 'list' || !currentTagId) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-secondary)] gap-3 p-8">
          <svg className="w-12 h-12 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <p className="text-sm">Select an article to read</p>
        </div>
      );
    }

    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full text-[var(--color-text-secondary)]">
          Loading...
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-4">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={clearError} className="text-xs text-[var(--color-accent)] hover:underline">
            Dismiss
          </button>
        </div>
      );
    }

    if (isGenerating) {
      return <WikiGenerating tagName={currentTagName || ''} atomCount={articleStatus?.current_atom_count || 0} />;
    }

    if (!currentArticle) {
      return (
        <WikiEmptyState
          tagName={currentTagName || ''}
          atomCount={articleStatus?.current_atom_count || 0}
          onGenerate={handleGenerate}
          isGenerating={false}
        />
      );
    }

    const displayArticle = selectedVersion
      ? { content: selectedVersion.content, id: selectedVersion.id, tag_id: selectedVersion.tag_id, created_at: selectedVersion.created_at, updated_at: selectedVersion.created_at, atom_count: selectedVersion.atom_count }
      : currentArticle.article;
    const displayCitations = selectedVersion
      ? selectedVersion.citations
      : currentArticle.citations;

    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto scrollbar-auto-hide">
          <WikiArticleContent
            article={displayArticle}
            citations={displayCitations}
            wikiLinks={selectedVersion ? [] : wikiLinks}
            relatedTags={selectedVersion ? [] : relatedTags}
            tagName={currentTagName || ''}
            updatedAt={selectedVersion ? selectedVersion.created_at : currentArticle.article.updated_at}
            sourceCount={displayCitations.length}
            titleActions={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowRegenerateModal(true)}
                  disabled={isUpdating || !!selectedVersion}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </Button>
                <button
                  onClick={goBack}
                  className="md:hidden text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors p-1"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </>
            }
            onViewAtom={handleViewAtom}
            onNavigateToArticle={(tagId, tagName) => openArticle(tagId, tagName)}
          />
        </div>

        {/* Regenerate confirmation modal */}
        <Modal
          isOpen={showRegenerateModal}
          onClose={() => setShowRegenerateModal(false)}
          title="Regenerate Article"
          confirmLabel="Regenerate"
          confirmVariant="primary"
          onConfirm={() => {
            setShowRegenerateModal(false);
            handleGenerate();
          }}
        >
          <p className="text-[var(--color-text-primary)]">
            This will regenerate the article from scratch, replacing the current content.
            The current version will be saved in the version history.
            Are you sure you want to continue?
          </p>
        </Modal>
      </div>
    );
  };

  // On mobile (no sidebar), show the article list when nothing is selected
  const showMobileList = !currentTagId || view === 'list';

  return (
    <div className="h-full overflow-hidden">
      {/* On mobile, swap between list and article */}
      <div className="md:hidden h-full">
        {showMobileList ? (
          <WikiArticlesList />
        ) : (
          renderArticleContent()
        )}
      </div>
      <div className="hidden md:block h-full">
        {renderArticleContent()}
      </div>
    </div>
  );
}
