import { useEffect, useState } from 'react';
import { LeftPanel } from './LeftPanel';
import { MainView } from './MainView';
import { RightDrawer } from './RightDrawer';
import { LoadingIndicator } from '../ui/LoadingIndicator';
import { SettingsModal } from '../settings/SettingsModal';
import { useAtomsStore } from '../../stores/atoms';
import { useTagsStore } from '../../stores/tags';
import { useTheme } from '../../hooks';
import { resetStuckProcessing, processPendingEmbeddings, processPendingTagging, verifyProviderConfigured } from '../../lib/tauri';

export function Layout() {
  useTheme(); // Initialize theme
  const { fetchAtoms } = useAtomsStore();
  const { fetchTags } = useTagsStore();
  const [isSetupRequired, setIsSetupRequired] = useState<boolean | null>(null); // null = checking

  // Check if setup is needed on mount
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const configured = await verifyProviderConfigured();
        setIsSetupRequired(!configured);

        if (configured) {
          // Only initialize app if provider is configured
          await initializeApp();
        }
      } catch (error) {
        console.error('Failed to check provider configuration:', error);
        // If check fails, show setup anyway
        setIsSetupRequired(true);
      }
    };

    checkSetup();
  }, []);

  const initializeApp = async () => {
    // Fetch initial data first
    await Promise.all([fetchAtoms(), fetchTags()]);

    // Reset any atoms stuck in 'processing' from interrupted sessions
    try {
      const resetCount = await resetStuckProcessing();
      if (resetCount > 0) {
        console.log(`Reset ${resetCount} atoms stuck in processing state`);
      }
    } catch (error) {
      console.error('Failed to reset stuck processing:', error);
    }

    // Phase 1: Process any pending embeddings in the background (fast)
    try {
      const embeddingCount = await processPendingEmbeddings();
      if (embeddingCount > 0) {
        console.log(`Processing ${embeddingCount} pending embeddings in background...`);
      }
    } catch (error) {
      console.error('Failed to start pending embeddings:', error);
      // Don't block app startup on embedding failure
    }

    // Phase 2: Process any pending tagging in the background (slower, after embeddings)
    try {
      const taggingCount = await processPendingTagging();
      if (taggingCount > 0) {
        console.log(`Processing ${taggingCount} pending tagging operations in background...`);
        console.log(`Tag extraction uses LLM API (may be rate-limited).`);

        if (taggingCount > 100) {
          console.warn(
            `Large batch detected. Processing ${taggingCount} atoms for tagging may take 10-30 minutes. ` +
            `Watch for atoms to update as processing completes.`
          );
        }
      }
    } catch (error) {
      console.error('Failed to start pending tagging:', error);
      // Don't block app startup on tagging failure
    }
  };

  const handleSetupComplete = async () => {
    setIsSetupRequired(false);
    // Now initialize the app
    await initializeApp();
  };

  // Show loading while checking
  if (isSetupRequired === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg-main)]">
        <span className="text-[var(--color-text-secondary)]">Loading...</span>
      </div>
    );
  }

  // Show setup modal if required
  if (isSetupRequired) {
    return (
      <div className="flex h-screen overflow-hidden bg-[var(--color-bg-main)]">
        <SettingsModal
          isOpen={true}
          onClose={handleSetupComplete}
          isSetupMode={true}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg-main)]">
      <LeftPanel />
      <MainView />
      <RightDrawer />
      <LoadingIndicator />
    </div>
  );
}

