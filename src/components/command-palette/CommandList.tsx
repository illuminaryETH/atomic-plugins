import { memo } from 'react';
import { Command, FuzzyMatch, CommandCategory } from './types';
import { CommandItem, CommandMatchItem } from './CommandItem';
import { categoryLabels } from './commands';

interface CommandListProps {
  recentCommands: Command[];
  filteredCommands: FuzzyMatch[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  hasQuery: boolean;
  query: string;
}

export const CommandList = memo(function CommandList({
  recentCommands,
  filteredCommands,
  selectedIndex,
  onSelect,
  hasQuery,
  query,
}: CommandListProps) {
  // Group filtered commands by category
  const groupedCommands = new Map<CommandCategory, FuzzyMatch[]>();

  for (const match of filteredCommands) {
    const category = match.command.category;
    if (!groupedCommands.has(category)) {
      groupedCommands.set(category, []);
    }
    groupedCommands.get(category)!.push(match);
  }

  // Build a flat list of all items with their indices for correct selection tracking
  const items: Array<{ type: 'recent' | 'command'; data: Command | FuzzyMatch; category?: CommandCategory }> = [];

  // Add recent commands first (only when no query)
  if (!hasQuery) {
    for (const command of recentCommands) {
      items.push({ type: 'recent', data: command });
    }
  }

  // Add grouped commands
  for (const [category, matches] of groupedCommands.entries()) {
    for (const match of matches) {
      items.push({ type: 'command', data: match, category });
    }
  }

  // Group items by section for rendering
  const recentItems = items.filter(item => item.type === 'recent');
  const commandsByCategory = new Map<CommandCategory, typeof items>();
  for (const item of items) {
    if (item.type === 'command' && item.category) {
      if (!commandsByCategory.has(item.category)) {
        commandsByCategory.set(item.category, []);
      }
      commandsByCategory.get(item.category)!.push(item);
    }
  }

  return (
    <div className="overflow-y-auto max-h-[50vh] py-2">
      {/* Recent commands section (only when no query) */}
      {recentItems.length > 0 && (
        <div className="mb-2">
          <div className="px-4 py-1.5 text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">
            Recent
          </div>
          {recentItems.map((item, idx) => {
            const command = item.data as Command;
            return (
              <CommandItem
                key={`recent-${command.id}`}
                command={command}
                isSelected={selectedIndex === idx}
                onClick={() => onSelect(idx)}
              />
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {filteredCommands.length === 0 && hasQuery && (
        <div className="px-4 py-8 text-center text-[var(--color-text-tertiary)] text-sm">
          No commands found for "{query}"
        </div>
      )}

      {/* Commands grouped by category */}
      {Array.from(commandsByCategory.entries()).map(([category, categoryItems]) => (
        <div key={category} className="mb-2">
          <div className="px-4 py-1.5 text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">
            {categoryLabels[category]}
          </div>
          {categoryItems.map((item) => {
            const match = item.data as FuzzyMatch;
            // Find the actual index in the flat items array
            const actualIndex = items.indexOf(item);
            return (
              <CommandMatchItem
                key={match.command.id}
                match={match}
                isSelected={selectedIndex === actualIndex}
                onClick={() => onSelect(actualIndex)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
});
