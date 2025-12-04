import { cn } from '@/lib/utils';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export function ChatMessage({ role, content, timestamp }: ChatMessageProps) {
  const isUser = role === 'user';

  const formatTimestamp = (date: Date) => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12;
    const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes;
    return `${formattedHours}:${formattedMinutes} ${ampm}`;
  };

  return (
    <div
      className={cn(
        'flex flex-col mb-4',
        isUser ? 'items-end' : 'items-start'
      )}
    >
      <div
        className={cn(
          'max-w-[80%] px-4 py-3 whitespace-pre-wrap break-words',
          isUser
            ? 'bg-[#0066CC] text-white rounded-[12px_12px_0_12px]'
            : 'bg-[#F0F7FF] text-gray-900 rounded-[12px_12px_12px_0]'
        )}
      >
        {content}
      </div>
      <div className="text-xs text-gray-500 mt-1 px-1">
        {formatTimestamp(timestamp)}
      </div>
    </div>
  );
}
