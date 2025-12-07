import { useState } from 'react';
import { TagTree } from '../tags/TagTree';
import { TagSearch } from '../tags/TagSearch';
import { SettingsButton, SettingsModal } from '../settings';

export function LeftPanel() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <aside 
      className="w-[250px] h-full bg-[var(--color-bg-panel)] border-r border-[var(--color-border)] flex flex-col transition-colors duration-300"
      style={{ backdropFilter: 'blur(var(--backdrop-blur))' }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <h1 className="text-lg font-bold text-[var(--color-text-primary)] flex items-center gap-2">
          <svg className="w-5 h-5 text-[var(--color-accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Atomic
        </h1>
        <SettingsButton onClick={() => setIsSettingsOpen(true)} />
      </div>

      {/* Tag Search */}
      <TagSearch />

      {/* Tag Tree */}
      <div className="flex-1 overflow-hidden">
        <TagTree />
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </aside>
  );
}

