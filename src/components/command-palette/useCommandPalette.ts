import { useState, useCallback, useEffect, useMemo } from 'react';
import { FuzzyMatch } from './types';
import { commands } from './commands';
import { searchCommands } from './fuzzySearch';

const RECENT_COMMANDS_KEY = 'atomic-recent-commands';
const MAX_RECENT_COMMANDS = 5;

interface UseCommandPaletteOptions {
  isOpen: boolean;
  onClose: () => void;
}

export function useCommandPalette({ isOpen, onClose }: UseCommandPaletteOptions) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentCommandIds, setRecentCommandIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_COMMANDS_KEY);
      if (stored) {
        setRecentCommandIds(JSON.parse(stored));
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const filteredCommands: FuzzyMatch[] = useMemo(() => {
    return searchCommands(query, commands);
  }, [query]);

  const recentCommands = useMemo(() => {
    if (query.trim()) return [];

    return recentCommandIds
      .map((id) => commands.find((cmd) => cmd.id === id))
      .filter((cmd): cmd is NonNullable<typeof cmd> => cmd !== undefined)
      .filter((cmd) => cmd.isEnabled?.() ?? true);
  }, [query, recentCommandIds]);

  const totalItems = useMemo(() => {
    return query.trim() ? filteredCommands.length : recentCommands.length + filteredCommands.length;
  }, [query, filteredCommands.length, recentCommands.length]);

  const recordRecentCommand = useCallback((commandId: string) => {
    setRecentCommandIds((prev) => {
      const filtered = prev.filter((id) => id !== commandId);
      const updated = [commandId, ...filtered].slice(0, MAX_RECENT_COMMANDS);

      try {
        localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(updated));
      } catch {
        // Ignore localStorage errors
      }

      return updated;
    });
  }, []);

  const handleSelect = useCallback(
    (index: number) => {
      let command;
      if (!query.trim() && index < recentCommands.length) {
        command = recentCommands[index];
      } else {
        const adjustedIndex = query.trim() ? index : index - recentCommands.length;
        command = filteredCommands[adjustedIndex]?.command;
      }

      if (command) {
        recordRecentCommand(command.id);
        onClose();
        command.action();
      }
    },
    [query, recentCommands, filteredCommands, recordRecentCommand, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, totalItems - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          handleSelect(selectedIndex);
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [selectedIndex, totalItems, handleSelect, onClose]
  );

  return {
    query,
    setQuery,
    selectedIndex,
    filteredCommands,
    recentCommands,
    handleKeyDown,
    handleSelect,
  };
}
