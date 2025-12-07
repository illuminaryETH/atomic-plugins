import { ConversationWithTags } from '../../stores/chat';
import { formatRelativeDate } from '../../lib/date';

interface ConversationCardProps {
  conversation: ConversationWithTags;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

export function ConversationCard({ conversation, onClick, onDelete }: ConversationCardProps) {
  const title = conversation.title || 'New Conversation';
  const preview = conversation.last_message_preview || 'No messages yet';
  const messageCount = conversation.message_count;
  const updatedAt = formatRelativeDate(conversation.updated_at);

  return (
    <div
      onClick={onClick}
      className="group px-4 py-3 hover:bg-[var(--color-bg-card)] cursor-pointer transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3 className="text-[var(--color-text-primary)] font-medium truncate mb-1">
            {title}
          </h3>

          {/* Preview */}
          <p className="text-[var(--color-text-secondary)] text-sm line-clamp-2 mb-2">
            {preview}
          </p>

          {/* Meta info */}
          <div className="flex items-center gap-3 text-xs text-[var(--color-text-tertiary)]">
            <span>{updatedAt}</span>
            <span>•</span>
            <span>{messageCount} {messageCount === 1 ? 'message' : 'messages'}</span>
          </div>

          {/* Tags */}
          {conversation.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {conversation.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag.id}
                  className="px-2 py-0.5 text-xs rounded bg-[var(--color-accent)]/20 text-[var(--color-accent-light)]"
                >
                  {tag.name}
                </span>
              ))}
              {conversation.tags.length > 3 && (
                <span className="px-2 py-0.5 text-xs rounded bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]">
                  +{conversation.tags.length - 3} more
                </span>
              )}
            </div>
          )}
        </div>

        {/* Delete button */}
        <button
          onClick={onDelete}
          className="p-1.5 text-[var(--color-text-tertiary)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
          aria-label="Delete conversation"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}
