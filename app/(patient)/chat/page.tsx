'use client';

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  Fragment,
} from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Send, Loader2, MapPin } from 'lucide-react';
import { useUser } from '@/hooks/useUser';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

import EmergencyScreen from '@/components/chat/EmergencyScreen';
import RestrictedScreen from '@/components/chat/RestrictedScreen';
import CrisisScreen from '@/components/chat/CrisisScreen';
import PrescriptionUpload from '@/components/chat/PrescriptionUpload';
import SymptomIntakeForm from '@/components/chat/SymptomIntakeForm';
import IntakeStatusTracker from '@/components/chat/IntakeStatusTracker';
import ConsentPrompt from '@/components/chat/ConsentPrompt';
import ChatMarkdown from '@/components/chat/ChatMarkdown';
import { consumeAssistantResponse } from '@/lib/chat-stream';

export const dynamic = 'force-dynamic';

type MessageRole = 'user' | 'assistant';

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  results?: any[];
  streaming?: boolean;
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
  if (['ikeja', 'victoria island', 'lekki', 'yaba'].some((loc) => text.startsWith(loc))) {
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
  { label: 'Find a cheaper generic', token: 'Find a cheaper generic' },
  { label: 'Reserve medication', token: 'Reserve medication' },
  { label: 'Dosage instructions', token: 'Dosage instructions' },
] as const;

const quickActionsFollowUp = [
  { label: 'Show results again', token: '__SHOW_RESULTS__' },
  { label: 'Compare prices', token: '__COMPARE_PRICES__' },
  { label: 'New medication', token: '__NEW_SEARCH__' },
] as const;

export default function Chat() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const { user, isLoading: isUserLoading } = useUser();

  const [threadId] = useState(() => generateMessageId());
  const [activeSafetyScreen, setActiveSafetyScreen] = useState<'emergency' | 'restricted' | 'crisis' | 'symptom_intake' | 'prescription_upload' | 'intake_tracker' | null>(null);
  const [selectedProductName, setSelectedProductName] = useState('');
  const [currentIntakeId, setCurrentIntakeId] = useState<string | null>(null);
  const [manualLocationInput, setManualLocationInput] = useState('');

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
  const [userName, setUserName] = useState<string>('');
  const [isNameLoading, setIsNameLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) {
      setIsNameLoading(false);
      return;
    }

    const name = user.user_metadata?.full_name?.split(' ')[0] || '';
    if (name) {
      setUserName(name);
      setIsNameLoading(false);
      return;
    }

    const fetchName = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('users')
          .select('full_name')
          .eq('user_id', user.id)
          .single();

        if (error) throw error;

        const fullName = (data as any)?.full_name;
        if (fullName) {
          setUserName(fullName.split(' ')[0]);
        } else {
          setUserName(user.email?.split('@')[0] || '');
        }
      } catch (err) {
        console.error('Error fetching user profile name:', err);
        setUserName(user.email?.split('@')[0] || '');
      } finally {
        setIsNameLoading(false);
      }
    };

    fetchName();
  }, [user, isUserLoading]);

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
    if (isUserLoading || isNameLoading) return;
    if (!welcomeShownRef.current && messages.length === 0) {
      const nameToUse = userName || 'there';
      const welcome = `Hi ${nameToUse}. I'm your StocMed assistant. Tell me what medication you need, or describe how you're feeling.`;
      pushAssistantMessage(welcome);
      welcomeShownRef.current = true;
    }
  }, [isUserLoading, isNameLoading, messages.length, pushAssistantMessage, userName]);

  const requestAssistantMessage = useCallback(
    async (payload: {
      conversation: ConversationMessage[];
      query: string;
      pharmacies: any[];
      userLocation: UserLocation | null;
      searchLocation: string | null;
    }, onDelta: (text: string) => void) => {
      try {
        const response = await fetch('/api/chat/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return await consumeAssistantResponse(response, onDelta);
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
      const effectiveLocation = locationOverride ?? pendingLocationLabel;

      if (!userLocation && !effectiveLocation) {
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
        if (effectiveLocation) {
          params.set('location', effectiveLocation);
        }

        const response = await fetch(`/api/drugs/search?${params.toString()}`);
        const data = await response.json();
        const results = data.results || [];

        await fetch('/api/searches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: trimmedMedication,
            product_id: results[0]?.product_id ?? null,
            results_count: data.count || 0,
            location:
              effectiveLocation ??
              userLocation?.label ??
              null,
            metadata: {
              source: 'chat',
              latitude: userLocation?.latitude ?? null,
              longitude: userLocation?.longitude ?? null,
              location_label:
                effectiveLocation ?? userLocation?.label ?? null,
            },
          }),
        });
        setLastResults(results);
        setLastQueryText(trimmedMedication);
        setPendingMedication(trimmedMedication);
        setPendingLocationLabel(effectiveLocation || null);

        const assistantMessageId = generateMessageId();
        appendMessage({
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          results,
          streaming: true,
          createdAt: new Date().toISOString(),
        });

        let streamedMessage = '';
        const assistantReply = await requestAssistantMessage({
          conversation,
          query: trimmedMedication,
          pharmacies: results,
          userLocation,
          searchLocation: effectiveLocation ?? userLocation?.label ?? null,
        }, (delta) => {
          streamedMessage += delta;
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantMessageId
                ? { ...message, content: streamedMessage }
                : message
            )
          );
        });

        const locationHint = effectiveLocation || userLocation?.label || '';
        let finalMessage = `Found it. ${trimmedMedication} is in stock at ${results.length} pharmacies within 3km of ${locationHint || 'your area'}.`;

        if (results.length > 0) {
          const closest = results[0];
          const closestName = closest.pharmacies?.pharmacy_name || 'partner pharmacy';
          const closestAddr = closest.pharmacies?.address || '';
          const closestPrice = closest.price ? `₦${Number(closest.price).toLocaleString()}` : 'estimable price';
          const closestDist = closest.distance_km ? `${closest.distance_km.toFixed(1)}km away` : '';
          
          finalMessage += ` The closest is ${closestName} ${closestAddr ? `on ${closestAddr}` : ''} — ${closestPrice} per pack${closestDist ? `, ${closestDist}` : ''}.`;
        } else {
          finalMessage = `I couldn’t find pharmacies stocking “${trimmedMedication}” right now. Try double-checking the spelling or checking for a generic alternative.`;
        }

        if (assistantReply && assistantReply.trim().length) {
          finalMessage = assistantReply.trim();
        }

        setMessages((previous) =>
          previous.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: finalMessage, streaming: false }
              : message
          )
        );
        setConversation((previous) => [
          ...previous.slice(-10),
          { role: 'assistant', content: finalMessage },
        ]);
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
    [
      conversation,
      appendMessage,
      pushAssistantMessage,
      requestAssistantMessage,
      userLocation,
      pendingLocationLabel,
    ]
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

      setIsLoading(true);
      try {
        const triageRes = await fetch('/api/triage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trimmed, thread_id: threadId }),
        });
        if (!triageRes.ok) throw new Error('Triage failed');
        const triageData = await triageRes.json();

        // 1. Handle CRISIS
        if (triageData.risk_tier === 'CRISIS') {
          setActiveSafetyScreen('crisis');
          setIsLoading(false);
          return;
        }

        // Emergency UI is positive-signal-only: both classifier fields must agree.
        if (triageData.risk_tier === 'REDIRECT' && triageData.intent === 'RED_FLAG') {
          setActiveSafetyScreen('emergency');
          setIsLoading(false);
          return;
        }

        // 3. Handle BLOCK_SOURCING (Restricted drugs)
        if (triageData.risk_tier === 'BLOCK_SOURCING') {
          setActiveSafetyScreen('restricted');
          setIsLoading(false);
          return;
        }

        // Non-emergency redirects never display emergency numbers.
        if (
          triageData.risk_tier === 'CARE_REDIRECT' &&
          triageData.intent === 'SYMPTOM_GENERIC'
        ) {
          setActiveSafetyScreen('symptom_intake');
          setIsLoading(false);
          return;
        }

        // 5. Handle GATE (Prescription Only Medicine)
        if (triageData.risk_tier === 'GATE') {
          setSelectedProductName(triageData.matched_product_id || trimmed);
          setActiveSafetyScreen('prescription_upload');
          setIsLoading(false);
          return;
        }
      } catch (err) {
        console.error('Triage check error, falling back:', err);
      } finally {
        setIsLoading(false);
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
      threadId,
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
    <div className="flex-1 flex flex-col h-full min-h-0 bg-white relative">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-8 min-h-0">
        <div className="max-w-[720px] mx-auto flex flex-col gap-5">
          {/* Centered initial timestamp */}
          <div className="text-center mb-2">
            <span className="text-[12px] font-normal text-ink-muted bg-[var(--surface)] px-3.5 py-1.5 rounded-full">
              Today, {mounted ? new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase() : ''}
            </span>
          </div>

          {/* Location status / sharing widget (Compact style) */}
          {!userLocation && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 rounded-card border border-border bg-[var(--surface)] shadow-sm text-left">
              <div className="flex items-start gap-2.5">
                <MapPin className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                <div>
                  <h4 className="text-[14px] font-medium text-ink">Share your location</h4>
                  <p className="text-[13px] text-ink-muted mt-0.5">
                    Allow device location or type your area to rank nearby pharmacies.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Type area (e.g. Ikeja)"
                  value={manualLocationInput}
                  onChange={(e) => setManualLocationInput(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && manualLocationInput.trim()) {
                      await handleLocationInput(manualLocationInput.trim());
                      setManualLocationInput('');
                    }
                  }}
                  className="h-9 text-xs border border-border rounded-button px-3 bg-white outline-none focus:border-primary"
                />
                <Button
                  type="button"
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
                        setLocationError(error.message || 'Unable to fetch location.');
                        setIsLocating(false);
                      },
                      { enableHighAccuracy: true, timeout: 10000 }
                    );
                  }}
                  disabled={isLocating}
                  className="rounded-button bg-primary text-white text-[13px] font-medium h-9 px-4 hover:bg-[var(--primary-hover)]"
                >
                  {isLocating ? 'Locating...' : 'Share location'}
                </Button>
              </div>
            </div>
          )}

          {/* NDPR Consent Prompt */}
          <ConsentPrompt />

          {/* Active Safety Screens & Workflow Overlays */}
          {activeSafetyScreen === 'emergency' && (
            <EmergencyScreen
              onBack={() => setActiveSafetyScreen(null)}
              userState={userLocation?.label}
            />
          )}
          {activeSafetyScreen === 'restricted' && (
            <RestrictedScreen
              onBack={() => setActiveSafetyScreen(null)}
            />
          )}
          {activeSafetyScreen === 'crisis' && (
            <CrisisScreen
              onBack={() => setActiveSafetyScreen(null)}
            />
          )}
          {activeSafetyScreen === 'symptom_intake' && (
            <SymptomIntakeForm
              threadId={threadId}
              onSuccess={(intakeId) => {
                setCurrentIntakeId(intakeId);
                setActiveSafetyScreen('intake_tracker');
              }}
              onCancel={() => setActiveSafetyScreen(null)}
            />
          )}
          {activeSafetyScreen === 'prescription_upload' && (
            <PrescriptionUpload
              productName={selectedProductName}
              threadId={threadId}
              onSuccess={() => {
                setActiveSafetyScreen(null);
                pushAssistantMessage(`Your prescription for ${selectedProductName} has been submitted to our duty pharmacist for verification. You will be notified once it is approved.`);
              }}
            />
          )}
          {activeSafetyScreen === 'intake_tracker' && currentIntakeId && (
            <div className="space-y-4">
              <IntakeStatusTracker intakeId={currentIntakeId} />
              <Button
                onClick={() => setActiveSafetyScreen(null)}
                className="py-2.5 px-4 bg-surface hover:bg-border text-ink text-xs font-semibold rounded-xl border border-border transition-colors"
              >
                Close Status Tracker
              </Button>
            </div>
          )}

          {/* Message Thread */}
          {!activeSafetyScreen && messages.map((message) => {
            const isAssistant = message.role === 'assistant';
            const showCard = message.results && message.results.length > 0;

            // Generate search parameters for inline card
            const query = lastQueryText || pendingMedication || 'medication';
            const loc = pendingLocationLabel || userLocation?.label || 'nearby';
            const count = message.results?.length || 0;
            const prices = message.results?.map((r: any) => Number(r.price)).filter((p: number) => !isNaN(p)) || [];
            const minPrice = prices.length ? Math.min(...prices) : null;
            const priceText = minPrice ? `From ₦${minPrice.toLocaleString()}` : '';

            return (
              <Fragment key={message.id}>
                {isAssistant ? (
                  <div className="self-start bg-[var(--surface)] text-[var(--ink)] text-[15px] font-normal leading-[1.55] px-[18px] py-[14px] rounded-[12px_12px_12px_2px] max-w-[85%] text-left">
                    <ChatMarkdown content={message.content} />
                    {message.streaming && (
                      <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary align-middle" />
                    )}
                  </div>
                ) : (
                  <div className="self-end bg-[var(--primary)] text-white text-[15px] font-normal leading-[1.55] px-[18px] py-[14px] rounded-[12px_12px_2px_12px] max-w-[80%] whitespace-pre-line text-left">
                    {message.content}
                  </div>
                )}

                {/* Inline Search Results Card */}
                {isAssistant && showCard && (
                  <div className="self-start max-w-[85%] w-full">
                    <Link
                       href={`/search-results?q=${encodeURIComponent(query)}&location=${encodeURIComponent(loc)}`}
                      className="flex items-center justify-between gap-3 border border-border rounded-card p-4 bg-white hover:bg-surface transition-colors w-full shadow-xs text-left"
                    >
                      <div className="min-w-0">
                        <div className="text-[15px] font-medium text-ink truncate">
                          {query} · {count} {count === 1 ? 'result' : 'results'} near {loc}
                        </div>
                        <div className="text-[13px] text-ink-light mt-0.5 truncate">
                          {priceText ? `${priceText} ` : ''}
                          {message.results?.[0]?.distance_km ? `· nearest ${message.results[0].distance_km.toFixed(1)}km` : ''}
                        </div>
                      </div>
                      <span className="text-[14px] font-medium text-primary whitespace-nowrap flex-shrink-0">View results →</span>
                    </Link>
                  </div>
                )}
              </Fragment>
            );
          })}

          {/* Typing Indicator */}
          {isLoading && !messages.some((message) => message.streaming) && (
            <div className="self-start flex items-center gap-1.5 px-[18px] py-[14px]">
              <span className="w-1.5 h-1.5 rounded-full bg-ink-light animate-bounce" />
              <span className="w-1.5 h-1.5 rounded-full bg-ink-light animate-bounce [animation-delay:0.2s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-ink-light animate-bounce [animation-delay:0.4s]" />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 bg-white border-t border-border px-6 py-3 pb-4">
        <div className="max-w-[720px] mx-auto">
          {/* Quick chips */}
          <div className="flex gap-2 flex-wrap mb-3">
            {activeQuickActions.map((action) => (
              <Button
                key={action.token}
                onClick={() => handleQuickAction(action.token)}
                className="text-[13px] font-medium text-primary border border-border bg-white px-3.5 py-2 rounded-full cursor-pointer hover:bg-surface transition-colors"
              >
                {action.label}
              </Button>
            ))}
          </div>

          {/* Text Input */}
          <form onSubmit={handleSubmit} className="flex items-center gap-2.5">
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                stage === 'AWAITING_LOCATION'
                  ? 'Type your area or city...'
                  : 'Ask about a medication or symptom…'
              }
              disabled={isLoading}
              className="flex-1 h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60 min-w-0"
            />
            <Button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="w-12 h-12 rounded-button bg-primary flex items-center justify-center text-white text-[17px] flex-shrink-0 cursor-pointer hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-60"
            >
              →
            </Button>
          </form>

          {/* Disclaimer */}
          <p className="text-[12px] font-normal text-[#888] mt-2 text-center">
            StocMed gives guidance, not a diagnosis. Always confirm with a licensed pharmacist.
          </p>
        </div>
      </div>
    </div>
  );
}
