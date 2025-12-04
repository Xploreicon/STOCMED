import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, X, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { ChatInput } from '@/components/chat/ChatInput';
import { TypingIndicator } from '@/components/chat/TypingIndicator';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);

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

  const handleSend = () => {
    if (!inputValue.trim() || isTyping) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    // Simulate AI response
    setTimeout(() => {
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `I'm searching for "${userMessage.content}" in pharmacies near you. This is a simulated response. In a real implementation, this would connect to your backend API to search for medications.`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMessage]);
      setIsTyping(false);
    }, 1500);
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
          <h1 className="text-lg font-semibold text-gray-900">
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
            <ChatMessage
              key={message.id}
              role={message.role}
              content={message.content}
              timestamp={message.timestamp}
            />
          ))}
          {isTyping && <TypingIndicator />}
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
