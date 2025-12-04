export function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="bg-[#F0F7FF] rounded-[12px_12px_12px_0] px-4 py-3">
        <div className="flex gap-1.5">
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
        </div>
      </div>
    </div>
  );
}
