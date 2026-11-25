'use client';

import { usePatientFetch } from '@/hooks/usePatientFetch';
import { isPatientAbort } from '@/lib/patient-operation';

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
import { Send, MapPin, Navigation, Search, Plus, History, ShieldCheck } from 'lucide-react';
import { useUser } from '@/hooks/useUser';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

import EmergencyScreen from '@/components/chat/EmergencyScreen';
import RestrictedScreen from '@/components/chat/RestrictedScreen';
import CrisisScreen from '@/components/chat/CrisisScreen';
import ConsentPrompt from '@/components/chat/ConsentPrompt';
import ChatMarkdown from '@/components/chat/ChatMarkdown';
import { consumeAssistantResponse } from '@/lib/chat-stream';
import { resolvePatientSafetyAction } from '@/lib/triage/patient-safety-action';
import { SYMPTOM_INTAKE_UNAVAILABLE_MESSAGE } from '@/lib/triage/safe-responses';
import { medicineSearchParams, searchAreaLabel } from '../search-context';


type MessageRole = 'user' | 'assistant';

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  results?: any[];
  searchQuery?: string;
  searchLocation?: string;
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
  { label: 'Dosage instructions', token: 'Dosage instructions' },
] as const;

const quickActionsFollowUp = [
  { label: 'Show results again', token: '__SHOW_RESULTS__' },
  { label: 'Compare prices', token: '__COMPARE_PRICES__' },
  { label: 'New medication', token: '__NEW_SEARCH__' },
] as const;

export default function Chat() {
  const nativeFetch = usePatientFetch();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const { user, isLoading: isUserLoading } = useUser();

  const [threadId] = useState(() => generateMessageId());
  const [activeSafetyScreen, setActiveSafetyScreen] = useState<'emergency' | 'restricted' | 'crisis' | null>(null);
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
  const [pendingLocationLabel, setPendingLocationLabel] = useState<string | null>(() => searchAreaLabel(searchParams.get('location')));
  const [lastResults, setLastResults] = useState<any[]>([]);
  const [lastQueryText, setLastQueryText] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [isNameLoading, setIsNameLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activePageRef = useRef(false);

  useEffect(() => {
    activePageRef.current = true;
    setMounted(true);
    return () => { activePageRef.current = false; };
  }, []);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) {
      setIsNameLoading(false);
      return;
    }

    const name = user.full_name?.split(' ')[0] || '';
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
  const handledInitialQueryRef = useRef<string | null>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem('stocmed:userLocation');
      if (stored) {
        const parsed = JSON.parse(stored) as UserLocation;
        if (Number.isFinite(parsed.latitude) && Number.isFinite(parsed.longitude)) setUserLocation(parsed);
      }
    } catch {
      // Manual area search remains available if storage is blocked or malformed.
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
        const response = await nativeFetch('/api/chat/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return await consumeAssistantResponse(response, onDelta);
      } catch (error) {
        if (isPatientAbort(error)) throw error;
        console.error('Assistant fetch error:', error);
        return null;
      }
    },
    [nativeFetch]
  );

  const runSearch = useCallback(
    async ({
      medication,
      locationOverride,
      coordinates,
    }: {
      medication: string;
      locationOverride?: string | null;
      coordinates?: UserLocation | null;
    }) => {
      const trimmedMedication = medication.trim();
      if (!trimmedMedication) return;
      const effectiveLocation = locationOverride ?? pendingLocationLabel;
      const effectiveCoordinates = coordinates !== undefined ? coordinates : effectiveLocation ? null : userLocation;

      if (!effectiveCoordinates && !effectiveLocation) {
        pushAssistantMessage(
          'Share your area so I can rank pharmacies by distance (e.g. “Ikeja”, “Lekki”).'
        );
        setPendingMedication(trimmedMedication);
        setStage('AWAITING_LOCATION');
        return;
      }

      setIsLoading(true);

      try {
        const params = medicineSearchParams(trimmedMedication, effectiveLocation, effectiveCoordinates);

        const response = await nativeFetch(`/api/drugs/search?${params.toString()}`);
        const data = await response.json();
        const safetyRedirectAction = data?.safety_redirect?.action;
        if (
          safetyRedirectAction === 'crisis'
          || safetyRedirectAction === 'emergency'
          || safetyRedirectAction === 'restricted'
        ) {
          setActiveSafetyScreen(safetyRedirectAction);
          return;
        }
        if (!response.ok) {
          throw new Error(data?.error || `Search failed with status ${response.status}`);
        }
        const results = data.results || [];

        await nativeFetch('/api/searches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: trimmedMedication,
            product_id: results[0]?.product_id ?? null,
            results_count: data.count || 0,
            location:
              effectiveLocation ??
              effectiveCoordinates?.label ??
              null,
            metadata: {
              source: 'chat',
              latitude: effectiveCoordinates?.latitude ?? null,
              longitude: effectiveCoordinates?.longitude ?? null,
              location_label:
                effectiveLocation ?? effectiveCoordinates?.label ?? null,
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
          searchQuery: trimmedMedication,
          searchLocation: effectiveLocation || effectiveCoordinates?.label || 'nearby',
          streaming: true,
          createdAt: new Date().toISOString(),
        });

        let streamedMessage = '';
        const assistantReply = await requestAssistantMessage({
          conversation,
          query: trimmedMedication,
          pharmacies: results,
          userLocation: effectiveCoordinates,
          searchLocation: effectiveLocation ?? effectiveCoordinates?.label ?? null,
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
        let finalMessage = `I found ${results.length} ${results.length === 1 ? 'pharmacy' : 'pharmacies'} with ${trimmedMedication} near ${locationHint || 'your area'}.`;

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
        if (isPatientAbort(error)) return;
        console.error('Search error:', error);
        pushAssistantMessage(
          'I ran into an error while searching. Please try again in a moment.'
        );
      } finally {
        setIsLoading(false);
      }
    },
    [
      nativeFetch,
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
        const triageRes = await nativeFetch('/api/triage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trimmed, thread_id: threadId }),
        });
        if (!triageRes.ok) throw new Error('Triage failed');
        const triageData = await triageRes.json();
        const safetyAction = resolvePatientSafetyAction(
          triageData,
          false
        );

        if (safetyAction === 'crisis_redirect') {
          setActiveSafetyScreen('crisis');
          setIsLoading(false);
          return;
        }

        if (safetyAction === 'emergency_redirect') {
          setActiveSafetyScreen('emergency');
          setIsLoading(false);
          return;
        }

        if (safetyAction === 'restricted_redirect') {
          setActiveSafetyScreen('restricted');
          setIsLoading(false);
          return;
        }

        if (safetyAction === 'symptom_intake_unavailable') {
          pushAssistantMessage(SYMPTOM_INTAKE_UNAVAILABLE_MESSAGE);
          setIsLoading(false);
          return;
        }

      } catch (err) {
        if (isPatientAbort(err)) return;
        console.error('Triage check error:', err);
        pushAssistantMessage(
          'I could not complete the required safety check, so I have not shown medication results. Please try again. If this is urgent, call 112 or go to the nearest emergency department.'
        );
        return;
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
      nativeFetch,
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
    const query = initialQuery.trim();
    if (!query || isUserLoading || isNameLoading || messages.length === 0) return;
    if (handledInitialQueryRef.current === query) return;

    handledInitialQueryRef.current = query;
    void handleInput(query);
  }, [initialQuery, isUserLoading, isNameLoading, messages.length, handleInput]);

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
    <div data-tour-blocked={activeSafetyScreen ? 'true' : undefined} className="flex flex-1 min-h-0 gap-4 p-3 sm:p-5 lg:p-6">
      <aside className="hidden xl:flex w-56 shrink-0 flex-col gap-4 rounded-card border border-border bg-white p-4" aria-label="Search tools">
        <h2 className="text-base font-semibold text-ink">Your searches</h2>
        <Button variant="outline" className="justify-start gap-2 shadow-none" disabled={isLoading || Boolean(activeSafetyScreen)} onClick={() => handleQuickAction('__NEW_SEARCH__')}><Plus className="h-4 w-4" aria-hidden="true" /> New medicine search</Button>
        {lastQueryText && <div className="rounded-button bg-surface p-3 text-sm text-ink"><span className="mb-1 block text-xs text-ink-muted">Current search</span>{lastQueryText}</div>}
        <Link href="/history" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary hover:underline"><History className="h-4 w-4" aria-hidden="true" /> Search history</Link>
        <p className="mt-auto text-xs leading-relaxed text-ink-muted">Previous medicine searches are saved in your history. Start a search to check current availability.</p>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col min-h-0 rounded-card border border-border bg-white overflow-hidden" aria-label="StocMed chat search">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <h1 className="text-base font-semibold text-ink">StocMed assistant</h1>
        <Link href="/history" className="inline-flex min-h-8 items-center gap-1.5 text-xs font-medium text-primary xl:hidden"><History className="h-4 w-4" aria-hidden="true" /> History</Link>
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1.5 text-xs text-ink-muted"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Medicine search</span>
      </div>
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 min-h-0">
        <div className="max-w-[720px] mx-auto flex flex-col gap-5">
          <p className="rounded-button bg-warning/10 px-3 py-2 text-xs leading-relaxed text-ink-muted">StocMed gives guidance, not a diagnosis. Always confirm with a licensed pharmacist.</p>
          {/* Centered initial timestamp */}
          <div className="text-center mb-2">
            <span className="text-[12px] font-normal text-ink-muted bg-[var(--surface)] px-3.5 py-1.5 rounded-full">
              Today, {mounted ? new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase() : ''}
            </span>
          </div>

          {/* Location status / sharing widget (Compact style) */}
          {!userLocation && (
            <div className="flex flex-col gap-4 p-4 rounded-card bg-surface text-left">
              <div className="flex items-start gap-2.5">
                <MapPin className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                <div>
                  <h2 className="text-sm font-semibold text-ink">Choose your search area</h2>
                  <p className="text-[13px] text-ink-muted mt-0.5">
                    Allow device location or type your area to rank nearby pharmacies.
                  </p>
                </div>
              </div>
              <form className="flex flex-col sm:flex-row sm:items-center gap-2" onSubmit={async (event) => {
                event.preventDefault();
                if (!manualLocationInput.trim()) return;
                setLocationError(null);
                await handleLocationInput(manualLocationInput.trim());
                setManualLocationInput('');
              }}>
                <label htmlFor="chat-area" className="sr-only">Area or city to search</label>
                <input
                  id="chat-area"
                  type="text"
                  placeholder="Type area (e.g. Ikeja)"
                  value={manualLocationInput}
                  onChange={(e) => setManualLocationInput(e.target.value)}
                  className="h-11 min-w-0 flex-1 text-sm border border-border rounded-button px-3 bg-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <Button type="submit" disabled={!manualLocationInput.trim() || isLoading} className="h-11 gap-2 text-sm shadow-none"><Search className="h-4 w-4" aria-hidden="true" /> Search this area</Button>
              </form>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => {
                    if (typeof window === 'undefined' || !navigator.geolocation) {
                      setLocationError('Your device does not support geolocation.');
                      return;
                    }
                    setIsLocating(true);
                    setLocationError(null);
                    navigator.geolocation.getCurrentPosition(
                      async (position) => {
                        if (!activePageRef.current) return;
                        const current = await createClient().auth.getSession().catch(() => null);
                        if (!activePageRef.current || current?.data.session?.user.id !== user?.id) return;
                        const location: UserLocation = {
                          latitude: Math.round(position.coords.latitude * 1e6) / 1e6,
                          longitude: Math.round(position.coords.longitude * 1e6) / 1e6,
                          label: 'your current location',
                          timestamp: Date.now(),
                        };
                        setUserLocation(location);
                        setPendingLocationLabel(null);
                        if (typeof window !== 'undefined') {
                          try {
                          window.localStorage.setItem(
                            'stocmed:userLocation',
                            JSON.stringify(location)
                          );
                          } catch { /* Location remains available for this search if storage is blocked. */ }
                        }
                        setIsLocating(false);
                        if (pendingMedication) {
                          runSearch({ medication: pendingMedication, locationOverride: '', coordinates: location });
                        }
                      },
                      (error) => {
                        if (!activePageRef.current) return;
                        setLocationError('We could not get your device location. Type an area or city above to continue.');
                        setIsLocating(false);
                      },
                      { enableHighAccuracy: true, timeout: 10000 }
                    );
                  }}
                  disabled={isLocating || isLoading}
                  className="self-start rounded-button bg-white text-primary text-sm font-medium min-h-11 gap-2 px-4 shadow-none"
                >
                  <Navigation className="h-4 w-4" aria-hidden="true" />{isLocating ? 'Locating…' : 'Use my current location'}
                </Button>
              {pendingLocationLabel && <p className="text-xs font-medium text-primary" role="status">Searching near {pendingLocationLabel}</p>}
              {locationError && <p className="text-sm text-danger" role="alert">{locationError}</p>}
            </div>
          )}
          {userLocation && <div className="flex flex-wrap items-center justify-between gap-2 rounded-button bg-surface px-3 py-2 text-xs text-ink-muted"><span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{pendingLocationLabel ? `Searching near ${pendingLocationLabel}` : 'Using your current location'}</span><Button variant="ghost" className="h-auto min-h-9 px-2 text-xs text-primary" disabled={isLoading} onClick={() => { setUserLocation(null); setPendingLocationLabel(null); }}>Change area</Button></div>}

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
          {/* Message Thread */}
          {!activeSafetyScreen && messages.map((message) => {
            const isAssistant = message.role === 'assistant';
            const showCard = message.results && message.results.length > 0;

            // Generate search parameters for inline card
            const query = message.searchQuery || lastQueryText || pendingMedication || 'medication';
            const loc = message.searchLocation || pendingLocationLabel || userLocation?.label || 'nearby';
            const count = message.results?.length || 0;
            const prices = message.results?.map((r: any) => Number(r.price)).filter((p: number) => !isNaN(p)) || [];
            const minPrice = prices.length ? Math.min(...prices) : null;
            const priceText = minPrice ? `From ₦${minPrice.toLocaleString()}` : '';

            return (
              <Fragment key={message.id}>
                {isAssistant ? (
                  <div className="self-start max-w-[95%] sm:max-w-[85%] text-left">
                  <div className="bg-surface text-ink text-sm font-normal leading-relaxed px-4 py-3 rounded-[8px_8px_8px_2px] break-words">
                    <ChatMarkdown content={message.content} />
                    {message.streaming && (
                      <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary align-middle" />
                    )}
                  </div><p className="mt-1.5 text-xs text-ink-muted">Assistant · {formatTimestamp(message.createdAt)}</p></div>
                ) : (
                  <div className="self-end max-w-[90%] sm:max-w-[80%] text-left">
                  <div className="bg-primary text-white text-sm font-normal leading-relaxed px-4 py-3 rounded-[8px_8px_2px_8px] whitespace-pre-line break-words">
                    {message.content}
                  </div><p className="mt-1.5 text-right text-xs text-ink-muted">You · {formatTimestamp(message.createdAt)}</p></div>
                )}

                {/* Inline Search Results Card */}
                {isAssistant && showCard && (
                  <div className="self-start max-w-[95%] sm:max-w-[85%] w-full">
                    <div className="mb-3 space-y-2" aria-label="Nearby pharmacy matches">
                      {message.results?.slice(0, 3).map((result: any) => {
                        const quantity = Number(result.quantity_in_stock || 0);
                        const stockLabel = quantity <= 0 ? 'Out of stock' : quantity <= (result.low_stock_threshold ?? 10) ? 'Low stock' : 'In stock';
                        const stockStyle = quantity <= 0 ? 'bg-danger/10 text-danger' : quantity <= (result.low_stock_threshold ?? 10) ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success';
                        const params = new URLSearchParams({ q: query, location: loc });
                        if (result.id) params.set('inventory', result.id);
                        return <Link key={result.id || `${result.pharmacies?.pharmacy_name}-${result.product_id}`} href={`/search-results?${params.toString()}`} className="flex flex-wrap items-center justify-between gap-3 rounded-button border border-border bg-white p-3 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                          <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-ink">{result.pharmacies?.pharmacy_name || 'Pharmacy'}</h3><p className="mt-1 text-xs text-ink-muted">{result.brand_name || result.name} {result.strength}</p><p className="mt-1 text-xs text-ink-muted">{typeof result.distance_km === 'number' ? `${result.distance_km.toFixed(1)} km away · ` : ''}{Number(result.price) > 0 ? `₦${Number(result.price).toLocaleString()} / pack` : 'Ask pharmacy for price'}</p></div>
                          <div className="flex flex-col items-end gap-2"><span className={`rounded-button px-2 py-1 text-xs font-medium ${stockStyle}`}>{stockLabel}</span><span className="text-xs font-semibold text-primary">View pharmacy →</span></div>
                        </Link>;
                      })}
                    </div>
                    <Link
                       data-tour="patient-view-results"
                       href={`/search-results?q=${encodeURIComponent(query)}&location=${encodeURIComponent(loc)}`}
                      className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 border border-border rounded-button p-4 bg-white hover:bg-surface transition-colors w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <div className="min-w-0">
                        <div className="text-[15px] font-medium text-ink truncate">
                          {query} · {count} {count === 1 ? 'match' : 'matches'} near {loc}
                        </div>
                        <div className="text-[13px] text-ink-light mt-0.5 truncate">
                          {priceText ? `${priceText} ` : ''}
                          {message.results?.[0]?.distance_km ? `· nearest ${message.results[0].distance_km.toFixed(1)}km` : ''}
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-primary whitespace-nowrap flex-shrink-0">Compare pharmacies →</span>
                    </Link>
                  </div>
                )}
              </Fragment>
            );
          })}

          {/* Typing Indicator */}
          {isLoading && !messages.some((message) => message.streaming) && (
            <div className="self-start flex items-center gap-1.5 px-4 py-3" role="status" aria-label="Assistant is thinking">
              <span className="w-1.5 h-1.5 rounded-full bg-ink-light animate-bounce" />
              <span className="w-1.5 h-1.5 rounded-full bg-ink-light animate-bounce [animation-delay:0.2s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-ink-light animate-bounce [animation-delay:0.4s]" />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 bg-white border-t border-border px-4 sm:px-6 py-3 pb-4">
        <div className="max-w-[720px] mx-auto">
          {/* Quick chips */}
          <div className="flex gap-2 flex-wrap mb-3">
            {activeQuickActions.map((action) => (
              <Button
                key={action.token}
                variant="ghost"
                onClick={() => handleQuickAction(action.token)}
                disabled={isLoading || Boolean(activeSafetyScreen)}
                className="h-auto min-h-9 text-xs font-medium text-primary bg-surface px-3 py-2 rounded-full cursor-pointer hover:bg-primary/10 transition-colors"
              >
                {action.label}
              </Button>
            ))}
          </div>

          {/* Text Input */}
          <form data-tour="patient-search-form" onSubmit={handleSubmit} className="flex items-center gap-2.5">
            <input
              data-tour="patient-search-input"
              type="text"
              aria-label="Message the StocMed assistant"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                stage === 'AWAITING_LOCATION'
                  ? 'Type your area or city...'
                  : 'Ask about a medication or symptom…'
              }
              disabled={isLoading || Boolean(activeSafetyScreen)}
              className="flex-1 h-12 border border-border rounded-button px-4 text-[15px] text-ink bg-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60 min-w-0"
            />
            <Button
              type="submit"
              aria-label="Send message"
              disabled={isLoading || !input.trim() || Boolean(activeSafetyScreen)}
              className="w-12 h-12 rounded-button bg-primary flex items-center justify-center text-white text-[17px] flex-shrink-0 cursor-pointer hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-60"
            >
              <Send className="h-5 w-5" aria-hidden="true" />
            </Button>
          </form>

          {/* Disclaimer */}
          <p className="mt-2 text-center text-[12px] font-normal text-ink-light">
            StocMed gives guidance, not a diagnosis. Always confirm with a licensed pharmacist.
          </p>
        </div>
      </div>
      </section>
    </div>
  );
}
