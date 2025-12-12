'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, Loader2 } from 'lucide-react';
import { useUser } from '@/hooks/useUser';
import DrugResultCard from '@/components/chat/DrugResultCard';

export const dynamic = 'force-dynamic';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  results?: any[];
}

interface UserLocation {
  latitude: number;
  longitude: number;
  label: string;
  timestamp: number;
}

const generateMessageId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export default function Chat() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const { user } = useUser();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [lastResultContext, setLastResultContext] = useState<{
    query: string;
    results: any[];
  } | null>(null);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [sessionId] = useState(() => {
    if (typeof window === 'undefined') return '';
    const stored = window.localStorage.getItem('stocmed:sessionId');
    if (stored) return stored;
    const newId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    window.localStorage.setItem('stocmed:sessionId', newId);
    return newId;
  });

  const welcomeSuggestions = useMemo(
    () => ['Paracetamol', 'Pain relief', 'Blood pressure medication'],
    []
  );

  // Save message to database or localStorage
  const saveMessage = useCallback(
    async (message: string, role: 'user' | 'assistant', metadata?: any) => {
      if (user) {
        // Save to database for logged-in users
        try {
          await fetch('/api/chat/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, role, metadata }),
          });
        } catch (error) {
          console.error('Error saving message to database:', error);
        }
      } else if (sessionId) {
        // Save to database for anonymous users with session ID
        try {
          await fetch('/api/chat/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, role, metadata, sessionId }),
          });
        } catch (error) {
          console.error('Error saving message for anonymous user:', error);
          // Fallback to localStorage if database save fails
          if (typeof window !== 'undefined') {
            try {
              const key = `stocmed:chat:${sessionId}`;
              const stored = window.localStorage.getItem(key);
              const messages = stored ? JSON.parse(stored) : [];
              messages.push({
                id: generateMessageId(),
                role,
                content: message,
                metadata,
                timestamp: new Date().toISOString(),
              });
              // Keep only last 50 messages
              if (messages.length > 50) {
                messages.splice(0, messages.length - 50);
              }
              window.localStorage.setItem(key, JSON.stringify(messages));
            } catch (localError) {
              console.error('Error saving to localStorage:', localError);
            }
          }
        }
      }
    },
    [user, sessionId]
  );

  const appendMessage = useCallback((message: Message, shouldSave = true) => {
    setMessages((prev) => [...prev, message]);
    if (shouldSave) {
      saveMessage(message.content, message.role, {
        results: message.results || null,
      });
    }
  }, [saveMessage]);

  const requestAssistantMessage = useCallback(
    async (payload: {
      conversation: ConversationMessage[];
      query: string;
      pharmacies: any[];
      userLocation: UserLocation | null;
    }) => {
      try {
        const response = await fetch('/api/chat/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          return null;
        }

        const data = await response.json();
        return typeof data.message === 'string' ? data.message : null;
      } catch (error) {
        console.error('Assistant fetch error:', error);
        return null;
      }
    },
    []
  );

  // Load user location from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('stocmed:userLocation');
    if (stored) {
      try {
        setUserLocation(JSON.parse(stored));
      } catch {
        // ignore malformed data
      }
    }
  }, []);

  // Load chat history (from database for logged-in users and anonymous with sessionId)
  useEffect(() => {
    const loadChatHistory = async () => {
      if (isLoadingHistory) return;

      setIsLoadingHistory(true);
      try {
        let historyMessages: Message[] = [];

        if (user) {
          // Load from database for logged-in users
          const response = await fetch('/api/chat/messages?limit=50');
          if (response.ok) {
            const data = await response.json();
            historyMessages = (data.messages || []).map((msg: any) => ({
              id: msg.id,
              role: msg.role,
              content: msg.message,
              results: msg.metadata?.results || undefined,
            }));
          }
        } else if (sessionId) {
          // Try to load from database for anonymous users
          try {
            const response = await fetch(`/api/chat/messages?limit=50&sessionId=${encodeURIComponent(sessionId)}`);
            if (response.ok) {
              const data = await response.json();
              historyMessages = (data.messages || []).map((msg: any) => ({
                id: msg.id,
                role: msg.role,
                content: msg.message,
                results: msg.metadata?.results || undefined,
              }));
            }
          } catch (dbError) {
            console.error('Error loading from database, trying localStorage:', dbError);
          }

          // Fallback to localStorage if database load failed or returned empty
          if (historyMessages.length === 0 && typeof window !== 'undefined') {
            const key = `stocmed:chat:${sessionId}`;
            const stored = window.localStorage.getItem(key);
            if (stored) {
              const messages = JSON.parse(stored);
              historyMessages = messages.map((msg: any) => ({
                id: msg.id || generateMessageId(),
                role: msg.role,
                content: msg.content,
                results: msg.metadata?.results || undefined,
              }));
            }
          }
        }

        if (historyMessages.length > 0) {
          setMessages(historyMessages);
          setConversation(
            historyMessages.map((msg) => ({
              role: msg.role,
              content: msg.content,
            }))
          );
        }
      } catch (error) {
        console.error('Error loading chat history:', error);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    loadChatHistory();
  }, [user, sessionId, isLoadingHistory]);

  const handleSearch = useCallback(
    async (rawQuery: string, options: { skipUserMessage?: boolean } = {}) => {
      const query = rawQuery.trim();
      if (!query) return;

      if (!options.skipUserMessage) {
        appendMessage({
          id: generateMessageId(),
          role: 'user',
          content: query,
        });
        setConversation((prev) => [
          ...prev,
          { role: 'user', content: query },
        ]);
      }

      if (!options.skipUserMessage) {
        setInput('');
      }
      setIsLoading(true);
      setLastResultContext(null);

      try {
        if (!userLocation) {
          setPendingQuery(query);
          setMessages((prev) => {
            const alreadyPrompted =
              prev.length > 0 &&
              prev[prev.length - 1]?.role === 'assistant' &&
              prev[prev.length - 1]?.content?.includes(
                'Before I show nearby pharmacies'
              );
            if (alreadyPrompted) return prev;
            return [
              ...prev,
              {
                id: generateMessageId(),
                role: 'assistant',
                content:
                  'Before I show nearby pharmacies, please share your location using the button below so I can rank results by distance.',
              },
            ];
          });
          setIsLoading(false);
          return;
        }

        const response = await fetch(
          `/api/drugs/search?q=${encodeURIComponent(query)}&lat=${userLocation.latitude}&lng=${userLocation.longitude}`
        );
        const data = await response.json();

        if (user) {
          await fetch('/api/searches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              results_count: data.count || 0,
            }),
          });
        }

        const results = data.results || [];

        const conversationForAssistant: ConversationMessage[] = [
          ...conversation,
          ...(options.skipUserMessage
            ? []
            : [{ role: 'user' as const, content: query }]),
        ];

        const assistantResponse = await requestAssistantMessage({
          conversation: conversationForAssistant,
          query,
          pharmacies: results,
          userLocation,
        });

        const assistantMessage: Message = {
          id: generateMessageId(),
          role: 'assistant',
          content: assistantResponse ?? (
            data.count > 0
              ? `I found ${data.count} medication${data.count !== 1 ? 's' : ''} for "${query}" near ${userLocation.label}. Browse the results below to see prices, stock levels, and pharmacy details.`
              : `I couldn't find any medications matching "${query}". Try a different spelling, or let me know what symptoms you're experiencing and I can suggest options.`
          ),
          results,
        };

        appendMessage(assistantMessage);
        setConversation((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: assistantMessage.content,
          },
        ]);
        setLastResultContext(
          results.length ? { query, results } : null
        );
      } catch (error) {
        console.error('Search error:', error);
        appendMessage({
          id: generateMessageId(),
          role: 'assistant',
          content:
            'Sorry, there was an error searching for medications. Please try again.',
        });
        setConversation((prev) => [
          ...prev,
          {
            role: 'assistant',
            content:
              'Sorry, there was an error searching for medications. Please try again.',
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [appendMessage, userLocation, user, conversation, requestAssistantMessage]
  );

  useEffect(() => {
    if (initialQuery && messages.length === 0) {
      handleSearch(initialQuery);
    }
  }, [initialQuery, messages.length, handleSearch]);

  useEffect(() => {
    if (userLocation && pendingQuery) {
      handleSearch(pendingQuery, { skipUserMessage: true });
      setPendingQuery(null);
    }
  }, [userLocation, pendingQuery, handleSearch]);

  const handleFollowUp = useCallback(
    async (rawInput: string) => {
      if (!lastResultContext) return;
      const content = rawInput.trim();
      if (!content) return;

      appendMessage({
        id: generateMessageId(),
        role: 'user',
        content,
      });
      setConversation((prev) => [...prev, { role: 'user', content }]);
      setInput('');
      setIsLoading(true);

      try {
        const conversationForAssistant: ConversationMessage[] = [
          ...conversation,
          { role: 'user', content },
        ];

        const assistantResponse = await requestAssistantMessage({
          conversation: conversationForAssistant,
          query: lastResultContext.query,
          pharmacies: lastResultContext.results,
          userLocation,
        });

        const fallback =
          'Thanks for the update. If you need education, a refill check, or help contacting the pharmacy, just tell me which one and I’ll guide you.';

        const assistantMessage: Message = {
          id: generateMessageId(),
          role: 'assistant',
          content: assistantResponse ?? fallback,
        };

        appendMessage(assistantMessage);
        setConversation((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: assistantMessage.content,
          },
        ]);
      } catch (error) {
        console.error('Follow-up assistant error:', error);
        appendMessage({
          id: generateMessageId(),
          role: 'assistant',
          content:
            'I had trouble reaching the assistant. Please try again in a moment or ask another question.',
        });
        setConversation((prev) => [
          ...prev,
          {
            role: 'assistant',
            content:
              'I had trouble reaching the assistant. Please try again in a moment or ask another question.',
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [appendMessage, conversation, lastResultContext, requestAssistantMessage, userLocation]
  );
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    const trimmed = input.trim();
    if (!trimmed) return;

    const normalized = trimmed.toLowerCase();
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    const followUpKeywords = [
      '1',
      'one',
      '2',
      'two',
      '3',
      'three',
      'yes',
      'yeah',
      'yup',
      'no',
      'nah',
      'new prescription',
      'new',
      'refill',
      'repeat',
      'education',
      'overview',
      'info',
      'pharmacist',
      'connect',
      'speak',
      'chat',
    ];

    const shouldFollowUp =
      !!lastResultContext &&
      wordCount <= 6 &&
      followUpKeywords.some(
        (keyword) =>
          normalized === keyword || normalized.includes(keyword)
      );

    if (shouldFollowUp) {
      handleFollowUp(trimmed);
    } else {
      handleSearch(trimmed);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-4 sm:py-8 pb-24 sm:pb-32">
        <div className="mb-4">
          <Card className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                {userLocation ? 'Using your saved location' : 'Share your location'}
              </h2>
              <p className="text-xs sm:text-sm text-gray-600 mt-1">
                {userLocation
                  ? `I’ll rank pharmacies by proximity to ${userLocation.label} (approx. ${userLocation.latitude}, ${userLocation.longitude}). You can update or clear it anytime.`
                  : 'I need your device location to show the nearest pharmacies and accurate pricing.'}
              </p>
              {locationError && (
                <p className="text-xs text-red-600 mt-2">{locationError}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (typeof window === 'undefined' || !navigator.geolocation) {
                    setLocationError('Your device does not support geolocation.');
                    return;
                  }
                  setIsLocating(true);
                  setLocationError(null);
                  navigator.geolocation.getCurrentPosition(
                    (position) => {
                      const location: UserLocation = {
                        latitude: Math.round(position.coords.latitude * 1000000) / 1000000,
                        longitude: Math.round(position.coords.longitude * 1000000) / 1000000,
                        label: 'your current location',
                        timestamp: Date.now(),
                      };
                      setUserLocation(location);
                      if (typeof window !== 'undefined') {
                        window.localStorage.setItem('stocmed:userLocation', JSON.stringify(location));
                      }
                      setIsLocating(false);
                    },
                    (error) => {
                      setLocationError(error.message || 'Unable to retrieve your location.');
                      setIsLocating(false);
                    },
                    { enableHighAccuracy: true, timeout: 10000 }
                  );
                }}
                disabled={isLocating}
              >
                {isLocating ? 'Fetching...' : userLocation ? 'Update location' : 'Share my location'}
              </Button>
              {userLocation && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setUserLocation(null);
                    if (typeof window !== 'undefined') {
                      window.localStorage.removeItem('stocmed:userLocation');
                    }
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          </Card>
        </div>

        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
            Medication Search
          </h1>
          <p className="text-sm sm:text-base text-gray-600 mt-2">
            Describe what you're looking for and I'll help you find it
          </p>
        </div>

        {/* Chat Messages */}
        <div className="space-y-4 sm:space-y-6">
          {messages.length === 0 && (
            <Card className="p-6 sm:p-8 text-center">
              <h2 className="text-lg sm:text-xl font-semibold mb-2">
                How can I help you today?
              </h2>
              <p className="text-sm sm:text-base text-gray-600">
                Type a medication name or describe your symptoms
              </p>
              <div className="mt-4 sm:mt-6 flex flex-wrap gap-2 justify-center">
                {welcomeSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleSearch(suggestion)}
                    className="px-3 sm:px-4 py-2 rounded-full bg-blue-50 hover:bg-blue-100 text-primary-blue text-xs sm:text-sm font-medium transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {message.role === 'user' ? (
                <div className="bg-primary-blue text-white rounded-2xl px-4 sm:px-6 py-3 max-w-[85%] sm:max-w-2xl">
                  <p className="text-sm sm:text-base">{message.content}</p>
                </div>
              ) : (
                <div className="w-full">
                  <div className="bg-white rounded-2xl px-4 sm:px-6 py-3 sm:py-4 shadow-sm mb-3 sm:mb-4">
                    <p className="text-sm sm:text-base text-gray-900 whitespace-pre-line">
                      {message.content}
                    </p>
                  </div>
                  {message.results && message.results.length > 0 && (
                    <div className="-mx-4 sm:mx-0 overflow-x-auto">
                      <div className="px-4 sm:px-0 flex gap-3 sm:gap-4 snap-x snap-mandatory">
                        {message.results.map((drug: any) => (
                          <DrugResultCard key={`${message.id}-${drug.id}`} drug={drug} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white rounded-2xl px-4 sm:px-6 py-3 sm:py-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin text-primary-blue" />
                  <p className="text-sm sm:text-base text-gray-600">
                    Searching medications...
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input Form - Fixed at bottom with mobile optimization */}
      <div className="fixed bottom-16 lg:bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 sm:p-4 z-[60] safe-bottom">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a medication name..."
              disabled={isLoading}
              className="flex-1 h-10 sm:h-12 text-sm sm:text-base"
            />
            <Button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="h-10 w-10 sm:h-12 sm:w-12 p-0 shrink-0"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
              ) : (
                <Send className="h-4 w-4 sm:h-5 sm:w-5" />
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
