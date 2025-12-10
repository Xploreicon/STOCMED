'use client';

import { useState, useEffect } from 'react';
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

export default function Chat() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const { user } = useUser();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (initialQuery && messages.length === 0) {
      handleSearch(initialQuery);
    }
  }, [initialQuery]);

  const handleSearch = async (query: string) => {
    if (!query.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: query,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/drugs/search?q=${encodeURIComponent(query)}`
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

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content:
          data.count > 0
            ? `I found ${data.count} medication${
                data.count !== 1 ? 's' : ''
              } matching "${query}". Here are the results:`
            : `I couldn't find any medications matching "${query}". Try a different search term or check the spelling.`,
        results: data.results || [],
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Search error:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content:
          'Sorry, there was an error searching for medications. Please try again.',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      handleSearch(input);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-4 sm:py-8 pb-24 sm:pb-32">
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
                {['Paracetamol', 'Pain relief', 'Blood pressure medication'].map(
                  (suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => handleSearch(suggestion)}
                      className="px-3 sm:px-4 py-2 rounded-full bg-blue-50 hover:bg-blue-100 text-primary-blue text-xs sm:text-sm font-medium transition-colors"
                    >
                      {suggestion}
                    </button>
                  )
                )}
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
                    <p className="text-sm sm:text-base text-gray-900">
                      {message.content}
                    </p>
                  </div>
                  {message.results && message.results.length > 0 && (
                    <div className="space-y-3 sm:space-y-4 sm:ml-4">
                      {message.results.map((drug: any) => (
                        <DrugResultCard key={drug.id} drug={drug} />
                      ))}
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
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 sm:p-4 z-50 safe-bottom">
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
