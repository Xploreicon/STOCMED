'use client';

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, Loader2, MapPin, Bot, Sparkles } from 'lucide-react';
import { useUser } from '@/hooks/useUser';
import DrugResultCard from '@/components/chat/DrugResultCard';

export const dynamic = 'force-dynamic';

type MessageRole = 'user' | 'assistant';

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  results?: any[];
  createdAt: string;
}

interface ConversationMessage {
  role: MessageRole;
  content: string;
}

interface UserLocation {
  latitude: number;
  longitude: number;
  label: string;
  timestamp: number;
}

type Stage =
  | 'AWAITING_MEDICATION'
  | 'AWAITING_LOCATION'
  | 'FOLLOW_UP';

const generateMessageId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const formatTimestamp = (iso: string) => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
};

const normalize = (value: string) => value.trim().toLowerCase();

const GREETING_PREFIXES = [
  'hello',
  'hi',
  'hey',
  'good morning',
  'good afternoon',
  'good evening',
];

const REQUEST_PHRASES = [
  'i need',
  'i am looking for',
  'looking for',
  'need pharmacies that have',
  'pharmacies that have',
  'find pharmacies with',
  'do you have',
  'can i get',
  'please find',
];

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'to',
  'for',
  'and',
  'with',
  'that',
  'have',
  'has',
  'please',
  'pharmacy',
  'pharmacies',
  'drug',
  'medication',
  'medicine',
  'someone',
  'somebody',
  'anyone',
  'anybody',
  'hello',
  'hi',
  'hey',
  'need',
  'search',
  'find',
]);

const GREETING_WORDS = new Set([
  'hello',
  'hi',
  'hey',
  'hiya',
  'good',
  'morning',
  'afternoon',
  'evening',
  'there',
]);

const isGreetingMessage = (raw: string) => {
  const cleaned = raw.replace(/[!?.]/g, ' ').trim().toLowerCase();
  if (!cleaned) return false;
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) return false;
  return tokens.every((token) => GREETING_WORDS.has(token));
};

const extractMedicationKeyword = (input: string): string | null => {
  let cleaned = input.trim();
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();
  for (const prefix of GREETING_PREFIXES) {
    if (lower.startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length).trim();
      break;
    }
  }

  let updated = cleaned;
  for (const phrase of REQUEST_PHRASES) {
    if (updated.toLowerCase().includes(phrase)) {
      updated = updated
        .toLowerCase()
        .replace(phrase, '')
        .replace(/^\s+/, '');
    }
  }

  if (!updated.trim()) {
    updated = cleaned;
  }

  const tokens = updated
    .split(/[\s,.;:!?]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !STOPWORDS.has(token.toLowerCase()));

  if (tokens.length === 0) {
    return cleaned.trim();
  }

  const candidates = tokens
    .sort((a, b) => b.length - a.length)
    .slice(0, 2)
    .join(' ');

  return candidates.trim() || cleaned.trim();
};

const resolveLocationLabel = (value: string) => {
  const text = normalize(value);
  if (!text) return null;
  if (['ikeja', 'victoria island', 'lekki'].some((loc) => text.startsWith(loc))) {
    return value.trim();
  }
  if (text.length >= 3) {
    return value.trim();
  }
  return null;
};

const formatCurrency = (value: number | null | undefined) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return `₦${value.toLocaleString()}`;
};

const describeStock = (quantity: number | null | undefined, threshold?: number | null) => {
  if (quantity === null || quantity === undefined) return 'Stock unknown';
  if (quantity <= 0) return 'Out of stock';
  if (threshold && quantity <= threshold) return `Low stock (${quantity} left)`;
  return `In stock (${quantity} available)`;
};

const formatResultBullet = (item: any) => {
  const pharmacy = item?.pharmacies ?? {};
  const name = pharmacy?.pharmacy_name ?? 'Unknown pharmacy';
  const medication = item?.name || item?.brand_name || item?.generic_name || 'Medication';
  const brand =
    item?.brand_name && item?.brand_name !== item?.name ? ` (${item.brand_name})` : '';
  const strength = item?.strength ? ` • ${item.strength}` : '';

  const priceRange =
    typeof item?.price_range_min === 'number' && typeof item?.price_range_max === 'number'
      ? `${formatCurrency(item.price_range_min)} – ${formatCurrency(item.price_range_max)}`
      : formatCurrency(item?.price) ?? 'Price unavailable';

  const stockText = describeStock(item?.quantity_in_stock ?? null, item?.low_stock_threshold);

  const distanceText =
    typeof item?.distance_km === 'number'
      ? `${item.distance_km.toFixed(1)} km away`
      : pharmacy?.city || pharmacy?.state
      ? [pharmacy.city, pharmacy.state].filter(Boolean).join(', ')
      : null;

  const details = [
    `${medication}${brand}${strength}`,
    `Price: ${priceRange}`,
    `Stock: ${stockText}`,
    distanceText ? `Distance: ${distanceText}` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  return `• **${name}** — ${details}`;
};

const quickActionsIntro = [
  { label: '🔍 Search by name', token: '__SEARCH_NAME__' },
  { label: '📍 Update my location', token: '__UPDATE_LOCATION__' },
  { label: '💊 Browse suggestions', token: '__BROWSE_SUGGESTIONS__' },
] as const;

const quickActionsFollowUp = [
  { label: '🔁 Show results again', token: '__SHOW_RESULTS__' },
  { label: '💰 Compare prices', token: '__COMPARE_PRICES__' },
  { label: '🆕 New medication', token: '__NEW_SEARCH__' },
] as const;

export default function Chat() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const { user } = useUser();

  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [stage, setStage] = useState<Stage>('AWAITING_MEDICATION');

  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  const [pendingMedication, setPendingMedication] = useState<string | null>(null);
  const [pendingLocationLabel, setPendingLocationLabel] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<any[]>([]);
  const [lastQueryText, setLastQueryText] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

const welcomeSuggestions = useMemo(
    () => ['Paracetamol', 'Amatem', 'Hypertension meds'],
    []
  );

  const welcomeMessage = useMemo(
    () =>
      [
        '👋 Hi, I’m your StocMed assistant.',
        '',
        'Tell me what medication you need + your area, and I’ll find nearby pharmacies.',
        '',
        'Example: “Paracetamol 500mg in Ikeja”',
        '',
        '⚠️ I find medications, not prescribe them.',
      ].join('\n'),
    []
  );

  const greetingReply = useMemo(
    () => 'Hi! What medication are you looking for today?',
    []
  );

  const welcomeShownRef = useRef(false);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('stocmed:userLocation');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as UserLocation;
        setUserLocation(parsed);
      } catch {
        // ignore malformed data
      }
    }
  }, []);

  const appendMessage = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const pushAssistantMessage = useCallback(
    (content: string, extra?: Partial<Message>) => {
      const msg: Message = {
        id: generateMessageId(),
        role: 'assistant',
        content,
        createdAt: new Date().toISOString(),
        ...extra,
      };
      appendMessage(msg);
      setConversation((prev) => [
        ...prev.slice(-10),
        { role: 'assistant', content },
      ]);
    },
    [appendMessage]
  );

  const pushUserMessage = useCallback(
    (content: string) => {
      const msg: Message = {
        id: generateMessageId(),
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      };
      appendMessage(msg);
      setConversation((prev) => [
        ...prev.slice(-10),
        { role: 'user', content },
      ]);
    },
    [appendMessage]
  );

  useEffect(() => {
    if (!welcomeShownRef.current && messages.length === 0) {
      pushAssistantMessage(welcomeMessage);
      welcomeShownRef.current = true;
    }
  }, [messages.length, pushAssistantMessage, welcomeMessage]);

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
        if (!response.ok) return null;
        const data = await response.json();
        return typeof data.message === 'string' ? data.message : null;
      } catch (error) {
        console.error('Assistant fetch error:', error);
        return null;
      }
    },
    []
  );

  const runSearch = useCallback(
    async ({
      medication,
      locationOverride,
    }: {
      medication: string;
      locationOverride?: string | null;
    }) => {
      const trimmedMedication = medication.trim();
      if (!trimmedMedication) return;

      if (!userLocation && !locationOverride) {
        pushAssistantMessage(
          'Share your area so I can rank pharmacies by distance (e.g. “Ikeja”, “Lekki”).'
        );
        setPendingMedication(trimmedMedication);
        setStage('AWAITING_LOCATION');
        return;
      }

      setIsLoading(true);

      try {
        const params = new URLSearchParams();
        params.set('q', trimmedMedication);
        if (userLocation) {
          params.set('lat', String(userLocation.latitude));
          params.set('lng', String(userLocation.longitude));
        }
        if (locationOverride) {
          params.set('location', locationOverride);
        }

        const response = await fetch(`/api/drugs/search?${params.toString()}`);
        const data = await response.json();

        if (user) {
          await fetch('/api/searches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: trimmedMedication,
              results_count: data.count || 0,
            }),
          });
        }

        const results = data.results || [];
        setLastResults(results);
        setLastQueryText(trimmedMedication);
        setPendingMedication(trimmedMedication);
        setPendingLocationLabel(locationOverride || null);

        const assistantReply = await requestAssistantMessage({
          conversation,
          query: trimmedMedication,
          pharmacies: results,
          userLocation,
        });

        const summaryParts: string[] = [];

        if (results.length > 0) {
          const locationHint =
            locationOverride || userLocation?.label
              ? ` around ${locationOverride ?? userLocation?.label}`
              : '';
          summaryParts.push(`Here’s what I found for “${trimmedMedication}”${locationHint}:`);
          const bulletLines = results.slice(0, 3).map(formatResultBullet);
          summaryParts.push(bulletLines.join('\n'));
          summaryParts.push(
            'Need another option? Ask for a different strength, brand, or location and I’ll keep searching.'
          );
        } else {
          summaryParts.push(`I couldn’t find pharmacies stocking “${trimmedMedication}” right now.`);
          summaryParts.push(
            [
              'Let’s try these next steps:',
              '• Double-check the spelling or share another brand name.',
              '• Tell me the generic ingredient if you know it.',
              '• Describe the condition so I can look for alternatives.',
              'I’m here to help—just give me more details.',
            ].join('\n')
          );
        }

        const summaryText = summaryParts.join('\n\n');
        let finalMessage =
          assistantReply && assistantReply.trim().length ? assistantReply.trim() : summaryText;

        if (results.length === 0 && assistantReply && assistantReply.trim().length) {
          finalMessage = `${assistantReply.trim()}\n\n${summaryText}`;
        }

        if (results.length > 0 && !finalMessage.toLowerCase().includes('tap a card')) {
          finalMessage = `${finalMessage}\n\nTap a card below to view pharmacy details or let me refine the search.`;
        }

        pushAssistantMessage(finalMessage, { results });
        setStage('FOLLOW_UP');
      } catch (error) {
        console.error('Search error:', error);
        pushAssistantMessage(
          'I ran into an error while searching. Please try again in a moment.'
        );
      } finally {
        setIsLoading(false);
      }
    },
    [conversation, pushAssistantMessage, requestAssistantMessage, user, userLocation]
  );

  const handleMedicationInput = useCallback(
    async (text: string) => {
      const keyword = extractMedicationKeyword(text);
      if (!keyword) return;
      await runSearch({ medication: keyword });
    },
    [runSearch]
  );

  const handleLocationInput = useCallback(
    async (text: string) => {
      const locationLabel = resolveLocationLabel(text);
      if (!locationLabel) {
        pushAssistantMessage(
          'Please share a more specific area or city name so I can search nearby pharmacies.'
        );
        return;
      }

      setPendingLocationLabel(locationLabel);
      setStage('AWAITING_MEDICATION');
      const medication = pendingMedication ?? lastQueryText;
      if (medication) {
        await runSearch({ medication, locationOverride: locationLabel });
      } else {
        pushAssistantMessage(
          `Location saved as ${locationLabel}. Tell me the medication you need.`
        );
      }
    },
    [pendingMedication, lastQueryText, pushAssistantMessage, runSearch]
  );

  const handleFollowUpInput = useCallback(
    async (text: string) => {
      if (!lastQueryText) {
        await handleMedicationInput(text);
        return;
      }

      const normalized = text.toLowerCase();
      const wantsStrength = normalized.includes('strength');
      const wantsForm =
        normalized.includes('form') ||
        normalized.includes('tablet') ||
        normalized.includes('capsule') ||
        normalized.includes('syrup');

      if (wantsStrength || wantsForm) {
        pushAssistantMessage(
          wantsStrength
            ? 'Reply with the strength you need (e.g. "500mg", "1000mg", or "not sure") and I’ll refine the list.'
            : 'Tell me the form you prefer (for example "tablets", "capsules", or "syrup") and I’ll refine the list.'
        );
        return;
      }

      const keyword = extractMedicationKeyword(`${lastQueryText} ${text}`);
      if (!keyword) return;

      await runSearch({
        medication: keyword,
        locationOverride: pendingLocationLabel,
      });
    },
    [handleMedicationInput, lastQueryText, pendingLocationLabel, runSearch, pushAssistantMessage]
  );

  const handleInput = useCallback(
    async (rawInput: string) => {
      const trimmed = rawInput.trim();
      if (!trimmed) return;

      pushUserMessage(trimmed);

      if (isGreetingMessage(trimmed)) {
        pushAssistantMessage(greetingReply);
        setStage('AWAITING_MEDICATION');
        return;
      }

      switch (stage) {
        case 'AWAITING_LOCATION':
          await handleLocationInput(trimmed);
          break;
        case 'FOLLOW_UP':
          await handleFollowUpInput(trimmed);
          break;
        default:
          await handleMedicationInput(trimmed);
          break;
      }
    },
    [
      stage,
      handleLocationInput,
      handleFollowUpInput,
      handleMedicationInput,
      pushUserMessage,
      pushAssistantMessage,
      greetingReply,
    ]
  );

  useEffect(() => {
    if (initialQuery && messages.length === 1) {
      pushUserMessage(initialQuery);
      handleMedicationInput(initialQuery);
    }
  }, [initialQuery, messages.length, handleMedicationInput, pushUserMessage]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isLoading) return;

    const trimmed = input.trim();
    if (!trimmed) return;
    setInput('');
    handleInput(trimmed);
  };

  const handleQuickAction = (token: string) => {
    switch (token) {
      case '__SEARCH_NAME__':
        pushAssistantMessage('Share the medication name, for example “Amatem softgel” or “Ibuprofen”.');
        setStage('AWAITING_MEDICATION');
        break;
      case '__UPDATE_LOCATION__':
        pushAssistantMessage('Tell me your area (e.g. Ikeja, Lekki) and I will rank pharmacies accordingly.');
        setStage('AWAITING_LOCATION');
        break;
      case '__BROWSE_SUGGESTIONS__':
        pushAssistantMessage(
          'Here are ideas to get started:\n• Malaria treatment\n• Blood pressure medication\n• Pain relief\nWhich should we explore?'
        );
        break;
      case '__SHOW_RESULTS__':
        if (pendingMedication) {
          runSearch({
            medication: pendingMedication,
            locationOverride: pendingLocationLabel,
          });
        }
        break;
      case '__COMPARE_PRICES__':
        pushAssistantMessage(
          'I’ll refresh the search so you can compare price ranges across pharmacies.'
        );
        if (pendingMedication) {
          runSearch({
            medication: pendingMedication,
            locationOverride: pendingLocationLabel,
          });
        }
        break;
      case '__NEW_SEARCH__':
        pushAssistantMessage('Sure—tell me the next medication you want to find.');
        setStage('AWAITING_MEDICATION');
        setPendingMedication(null);
        setLastResults([]);
        setLastQueryText(null);
        break;
      default:
        handleInput(token);
    }
  };

  const activeQuickActions =
    stage === 'FOLLOW_UP' && lastResults.length > 0
      ? quickActionsFollowUp
      : quickActionsIntro;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-4 sm:py-8 pb-28">
        <Card className="mb-5 border border-blue-100 bg-gradient-to-br from-white via-white to-blue-50/70 p-4 sm:p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-primary-blue">
                {userLocation ? 'Using your saved location' : 'Share your location'}
              </h2>
              <p className="text-xs sm:text-sm text-gray-600 mt-2 leading-relaxed">
                {userLocation
                  ? `Results are ranked near ${userLocation.label} (${userLocation.latitude}, ${userLocation.longitude}).`
                  : 'Send your device location or tell me your area so I can show nearby pharmacies.'}
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
                        latitude: Math.round(position.coords.latitude * 1e6) / 1e6,
                        longitude: Math.round(position.coords.longitude * 1e6) / 1e6,
                        label: 'your current location',
                        timestamp: Date.now(),
                      };
                      setUserLocation(location);
                      if (typeof window !== 'undefined') {
                        window.localStorage.setItem(
                          'stocmed:userLocation',
                          JSON.stringify(location)
                        );
                      }
                      setIsLocating(false);
                      if (pendingMedication) {
                        runSearch({ medication: pendingMedication });
                      }
                    },
                    (error) => {
                      setLocationError(
                        error.message || 'Unable to fetch your location.'
                      );
                      setIsLocating(false);
                    },
                    { enableHighAccuracy: true, timeout: 10000 }
                  );
                }}
                disabled={isLocating}
                className="rounded-full border-blue-200 bg-white text-primary-blue shadow-sm transition hover:bg-blue-100"
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
                    setStage('AWAITING_LOCATION');
                  }}
                  className="rounded-full px-4 text-xs sm:text-sm text-gray-500 hover:text-gray-700"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </Card>

        <div className="space-y-5 sm:space-y-6">
          {messages.map((message) => {
            const isAssistant = message.role === 'assistant';
            return (
              <div
                key={message.id}
                className={`flex ${isAssistant ? 'justify-start' : 'justify-end'}`}
              >
                {isAssistant ? (
                  <div className="flex max-w-3xl gap-3">
                    <div className="mt-1 hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-blue/10 text-primary-blue sm:flex">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="flex flex-col gap-3">
                      <div className="rounded-2xl border border-blue-100 bg-blue-50/80 px-4 py-3 text-sm text-gray-900 shadow-sm sm:px-5 sm:py-4 sm:text-[15px]">
                        <p className="whitespace-pre-line leading-relaxed">
                          {message.content}
                        </p>
                      </div>
                      <span className="text-xs font-medium uppercase tracking-wide text-blue-400">
                        {formatTimestamp(message.createdAt)}
                      </span>
                      {message.results && message.results.length > 0 && (
                        <div className="-mx-1 overflow-x-auto">
                          <div className="flex gap-4 px-1 pb-1 snap-x snap-mandatory">
                            {message.results.map((drug: any) => (
                              <DrugResultCard key={`${message.id}-${drug.id}`} drug={drug} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex max-w-3xl flex-col items-end gap-2 text-right">
                    <div className="rounded-2xl bg-gradient-to-r from-primary-blue to-blue-600 px-4 py-3 text-sm text-white shadow-md sm:px-5 sm:py-4 sm:text-base">
                      <p className="whitespace-pre-line leading-relaxed">{message.content}</p>
                    </div>
                    <span className="text-xs font-medium uppercase tracking-wide text-blue-200">
                      {formatTimestamp(message.createdAt)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {messages.length === 0 && (
            <Card className="p-6 sm:p-8 text-center">
              <h2 className="text-lg sm:text-xl font-semibold mb-2">
                How can I help you today?
              </h2>
              <p className="text-sm sm:text-base text-gray-600">
                Type a medication name or describe your symptoms
              </p>
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {welcomeSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleInput(suggestion)}
                    className="px-3 py-2 rounded-full bg-blue-50 text-primary-blue text-sm font-medium transition hover:bg-blue-100"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white rounded-2xl px-4 py-3 shadow-sm flex items-center gap-3">
                <Loader2 className="h-4 w-4 animate-spin text-primary-blue" />
                <p className="text-sm text-gray-600">Searching pharmacies...</p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 sm:p-4">
        <div className="max-w-4xl mx-auto space-y-3">
          <div className="flex flex-wrap gap-2">
            {activeQuickActions.map((action) => (
              <Button
                key={action.token}
                variant="outline"
                size="sm"
                onClick={() => handleQuickAction(action.token)}
                className="flex items-center gap-2 rounded-full border-blue-200 bg-white text-primary-blue shadow-sm transition hover:bg-blue-100"
              >
                {action.label}
              </Button>
            ))}
          </div>
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                stage === 'AWAITING_LOCATION'
                  ? 'Type your area or city...'
                  : 'Ask about medications...'
              }
              disabled={isLoading}
              className="flex-1 h-11 sm:h-12 text-sm sm:text-base"
            />
            <Button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="h-11 w-11 sm:h-12 sm:w-12 p-0"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
          <div className="flex flex-col gap-1 text-xs sm:text-sm text-gray-500">
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              Results ranked by your saved location when available.
            </span>
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary-blue" />
              Ask for strength, form, or a pharmacist connection anytime.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
