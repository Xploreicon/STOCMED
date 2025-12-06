import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, X, Minimize2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { ChatInput } from '@/components/chat/ChatInput';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { sendMessage } from '@/services/chatService';
import type { Message, SearchResult } from '@/types/drug';
import { DrugResultCard } from '@/components/chat/DrugResultCard';

interface ChatMessage extends Message {
  id: string;
  timestamp: Date;
  searchResults?: SearchResult;
}

const INITIAL_GREETING = `Hi! I'm StocMed AI, your medication finder. 👋

I can help you:
- Find medications across pharmacies
- Check prices and availability
- Suggest alternatives if needed

What medication are you looking for today?`;

const QUICK_ACTIONS = [
  { icon: '🔍', label: 'Find a drug', prefill: 'I need to find ' },
  { icon: '💰', label: 'Compare prices', prefill: 'Compare prices for ' },
  { icon: '📍', label: 'Nearest pharmacy', prefill: 'Find nearest pharmacy with ' },
];

export default function Chat() {
  const navigate = useNavigate();
  const location = useLocation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  // Send initial greeting on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      setMessages([
        {
          id: '1',
          role: 'assistant',
          content: INITIAL_GREETING,
          timestamp: new Date(),
        },
      ]);
    }, 300);

    return () => clearTimeout(timer);
  }, []);

  // Handle prefilled query from navigation state
  useEffect(() => {
    const state = location.state as { prefillQuery?: string } | null;
    if (state?.prefillQuery) {
      setInputValue(state.prefillQuery);
      // Clear the state to prevent re-filling on navigation
      window.history.replaceState({}, document.title);
    }
  }, [location]);

  const handleSend = async () => {
    if (!inputValue.trim() || isTyping) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);
    setError(null);

    try {
      // Convert messages to Message[] format for API (without id and timestamp)
      const conversationHistory: Message[] = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Get AI response
      const { message: aiResponse, searchResults } = await sendMessage(
        userMessage.content,
        conversationHistory
      );

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: aiResponse,
        timestamp: new Date(),
        searchResults,
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to get response';

      setError(errorMessage);

      const errorAiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again.",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, errorAiMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleRetry = () => {
    // Remove the last message (error message) and resend the previous user message
    if (messages.length >= 2) {
      const lastUserMessage = messages[messages.length - 2];
      if (lastUserMessage.role === 'user') {
        setMessages((prev) => prev.slice(0, -1)); // Remove error message
        setInputValue(lastUserMessage.content);
      }
    }
  };

  const handleQuickAction = (prefill: string) => {
    setInputValue(prefill);
  };

  const handleBack = () => {
    navigate('/dashboard');
  };

  const handleMinimize = () => {
    // Could implement minimize to a floating widget in future
    navigate('/dashboard');
  };

  const handleClose = () => {
    navigate('/dashboard');
  };

  const showQuickActions = messages.length === 1 && !isTyping;

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header - 64px */}
      <div className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            className="h-9 w-9"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-base sm:text-lg font-semibold text-gray-900">
            StocMed AI Assistant
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleMinimize}
            className="h-9 w-9"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="h-9 w-9"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Messages Area - Scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-6 pb-24">
        <div className="max-w-4xl mx-auto">
          {messages.map((message) => (
            <div key={message.id}>
              <ChatMessage
                role={message.role}
                content={message.content}
                timestamp={message.timestamp}
              />
              {/* Show search results if available */}
              {message.searchResults && message.searchResults.results.length > 0 && (
                <div className="mt-4 mb-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">
                    Available at {message.searchResults.results.length} pharmacies:
                  </h3>
                  {message.searchResults.results.map((result) => (
                    <DrugResultCard key={result.id} result={result} />
                  ))}
                </div>
              )}
            </div>
          ))}
          {isTyping && <TypingIndicator />}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-4">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetry}
                  className="flex items-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </Button>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Quick Action Buttons - Above Input */}
      {showQuickActions && (
        <div className="px-4 pb-4">
          <div className="max-w-4xl mx-auto flex gap-2 flex-wrap">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => handleQuickAction(action.prefill)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-primary-blue rounded-full text-sm font-medium hover:bg-blue-100 transition-colors border border-blue-200"
              >
                <span>{action.icon}</span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area - Fixed Bottom, 80px */}
      <ChatInput
        value={inputValue}
        onChange={setInputValue}
        onSend={handleSend}
        disabled={isTyping}
        placeholder="Ask about medications..."
      />
    </div>
  );
}
