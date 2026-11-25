'use client';

import { usePatientFetch } from '@/hooks/usePatientFetch';
import { isPatientAbort } from '@/lib/patient-operation';

import { Button } from '@/components/ui/button';

import { useCallback, useState, useEffect, useRef, type ChangeEvent, type FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, BadgeCheck, CheckCircle2, Lightbulb, Loader2, MapPin, Navigation, Phone, Truck, WifiOff, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import EmergencyScreen from '@/components/chat/EmergencyScreen';
import RestrictedScreen from '@/components/chat/RestrictedScreen';
import CrisisScreen from '@/components/chat/CrisisScreen';
import type { DeterministicSafetyRedirect } from '@/lib/triage/types';
import { medicineSearchParams } from '../search-context';


interface Pharmacy {
  pharmacy_name: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  operating_hours?: string;
  is_open_now?: boolean | null;
  license_number?: string;
  is_verified?: boolean;
  verification_status?: 'provisional' | 'full' | 'revoked';
  provisional_expires_at?: string | null;
  reservations_enabled: boolean;
  digital_prescription_reservations_enabled?: boolean;
}

interface DrugSearchResult {
  id: string;
  product_id: string;
  name: string;
  brand_name: string;
  generic_name: string;
  strength: string;
  dosage_form: string;
  price: number;
  price_range_min?: number;
  price_range_max?: number;
  quantity_in_stock: number;
  low_stock_threshold?: number;
  reserved_quantity?: number;
  requires_prescription?: boolean;
  distance_km?: number;
  pharmacies: Pharmacy;
}

function PomReservationMode({ item }: { item: DrugSearchResult }) {
  if (!item.requires_prescription) return null;

  const acceptsDigitalReservation =
    item.pharmacies.digital_prescription_reservations_enabled === true && item.quantity_in_stock > 0;

  return (
    <span
      className={acceptsDigitalReservation
        ? 'mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700'
        : 'mt-2 inline-flex rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-muted-foreground'}
    >
      {acceptsDigitalReservation ? 'Digital Rx reservation available' : 'Call pharmacy only'}
    </span>
  );
}

export default function SearchResults() {
  const nativeFetch = usePatientFetch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get('q') || '';
  const locationLabel = searchParams.get('location') || 'nearby';
  const inventoryToOpen = searchParams.get('inventory');

  const [results, setResults] = useState<DrugSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<DrugSearchResult | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [submittingPrescription, setSubmittingPrescription] = useState(false);
  const [reservationQuantity, setReservationQuantity] = useState(1);
  const [reservationMessage, setReservationMessage] = useState<string | null>(null);
  const [reservationMessageKind, setReservationMessageKind] = useState<'success' | 'error'>('success');
  const [prescriptionFile, setPrescriptionFile] = useState<File | null>(null);
  const [confirmedHold, setConfirmedHold] = useState<{ pickupCode: string; expiresAt: string; quantity: number } | null>(null);
  const [prescriptionSent, setPrescriptionSent] = useState(false);
  const [safetyRedirect, setSafetyRedirect] = useState<DeterministicSafetyRedirect | null>(null);
  const prescriptionInputRef = useRef<HTMLInputElement>(null);

  const fetchResults = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    setSafetyRedirect(null);
    try {
      let coordinates: { latitude: number; longitude: number } | null = null;
      try {
        const storedLoc = localStorage.getItem('stocmed:userLocation');
        if (storedLoc) {
          const parsed = JSON.parse(storedLoc);
          coordinates = { latitude: Number(parsed.latitude), longitude: Number(parsed.longitude) };
        }
      } catch {
        // A denied storage permission or old location record must not prevent a typed-area search.
      }

      const params = medicineSearchParams(query, locationLabel, coordinates);

      const response = await nativeFetch(`/api/drugs/search?${params.toString()}`);
      const data = await response.json();
      const safetyRedirectAction = data?.safety_redirect?.action;
      if (
        safetyRedirectAction === 'crisis'
        || safetyRedirectAction === 'emergency'
        || safetyRedirectAction === 'restricted'
      ) {
        setResults([]);
        setSafetyRedirect(data.safety_redirect as DeterministicSafetyRedirect);
        return;
      }
      if (!response.ok) {
        throw new Error(`Server status ${response.status}`);
      }
      setResults(data.results || []);
    } catch (err) {
      if (isPatientAbort(err)) return;
      console.error('Failed to load search results:', err);
      if (showLoading) setError('Could not connect to server. Please check your network connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [query, locationLabel, nativeFetch]);

  useEffect(() => {
    if (!query) {
      router.push('/chat');
      return;
    }
    fetchResults();
  }, [query, router, fetchResults]);

  const getStockInfo = (qty: number, threshold = 10) => {
    if (qty <= 0) {
      return { label: 'Out of stock', badgeColor: 'var(--danger)', badgeBg: 'var(--danger-tint)' };
    }
    if (qty <= threshold) {
      return { label: 'Low stock', badgeColor: 'var(--warning)', badgeBg: 'var(--warning-tint)' };
    }
    return { label: 'In stock', badgeColor: 'var(--success)', badgeBg: 'var(--success-tint)' };
  };

  const handleOpenDetail = useCallback((item: DrugSearchResult) => {
    setSelectedItem(item);
    setReservationQuantity(1);
    setReservationMessage(null);
    setReservationMessageKind('success');
    setPrescriptionFile(null);
    setConfirmedHold(null);
    setPrescriptionSent(false);
    if (prescriptionInputRef.current) prescriptionInputRef.current.value = '';
    setIsDetailOpen(true);
  }, []);

  useEffect(() => {
    if (!inventoryToOpen || loading || selectedItem) return;
    const match = results.find((item) => item.id === inventoryToOpen);
    if (match) handleOpenDetail(match);
  }, [inventoryToOpen, loading, selectedItem, results, handleOpenDetail]);

  const reservationErrorMessage = (status: number) => {
    if (status === 401) return 'Please sign in before submitting a reservation.';
    if (status === 403) return 'This pharmacy is not accepting this reservation.';
    if (status === 404) return 'This medicine is no longer available at the selected pharmacy.';
    if (status === 409) return 'Availability changed while you were submitting. Please refresh and try again.';
    if (status === 413) return 'The prescription file must be 5 MB or smaller.';
    if (status === 415) return 'Upload a JPEG, PNG, or PDF prescription.';
    if (status === 429) return 'Too many attempts. Please wait a moment and try again.';
    if (status === 503) return 'Digital prescription reservations are temporarily unavailable. Please call the pharmacy.';
    if (status >= 400 && status < 500) return 'Check the reservation details and try again.';
    return 'We could not submit this reservation. Please try again.';
  };

  const handleReserve = async () => {
    if (!selectedItem) return;
    if (!selectedItem.pharmacies.reservations_enabled || selectedItem.quantity_in_stock <= 0) return;
    const maximumQuantity = Math.min(10, selectedItem.quantity_in_stock);
    if (!Number.isInteger(reservationQuantity) || reservationQuantity < 1 || reservationQuantity > maximumQuantity) {
      setReservationMessageKind('error');
      setReservationMessage(`Enter an exact quantity between 1 and ${maximumQuantity}.`);
      return;
    }
    setReserving(true);
    setReservationMessage(null);
    try {
      const response = await nativeFetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventory_id: selectedItem.id, quantity: reservationQuantity }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(reservationErrorMessage(response.status));
      if (!body?.reservation?.expires_at || !body?.reservation?.pickup_code) {
        throw new Error('Your hold may not have completed. Please refresh before trying again.');
      }
      const until = new Date(body.reservation.expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      setReservationMessageKind('success');
      setReservationMessage(`Hold confirmed. Your pickup code is ${body.reservation.pickup_code}. Collect by ${until}.`);
      setConfirmedHold({ pickupCode: body.reservation.pickup_code, expiresAt: body.reservation.expires_at, quantity: reservationQuantity });
      void fetchResults(false);
    } catch (err) {
      if (isPatientAbort(err)) return;
      setReservationMessageKind('error');
      setReservationMessage(err instanceof Error ? err.message : 'Could not create your hold');
    } finally {
      setReserving(false);
    }
  };

  const handlePrescriptionFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    setReservationMessage(null);

    if (!file) {
      setPrescriptionFile(null);
      return;
    }

    const allowedTypes = new Set(['image/jpeg', 'image/png', 'application/pdf']);
    if (!allowedTypes.has(file.type)) {
      event.currentTarget.value = '';
      setPrescriptionFile(null);
      setReservationMessageKind('error');
      setReservationMessage('Upload a JPEG, PNG, or PDF prescription.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      event.currentTarget.value = '';
      setPrescriptionFile(null);
      setReservationMessageKind('error');
      setReservationMessage('The prescription file must be 5 MB or smaller.');
      return;
    }

    setPrescriptionFile(file);
  };

  const handlePrescriptionReservation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedItem?.requires_prescription) return;

    const maximumQuantity = Math.min(10, selectedItem.quantity_in_stock);
    if (!selectedItem.pharmacies.digital_prescription_reservations_enabled || maximumQuantity < 1) {
      setReservationMessageKind('error');
      setReservationMessage('This pharmacy is not accepting prescription reservations for this item.');
      return;
    }
    if (!Number.isInteger(reservationQuantity) || reservationQuantity < 1 || reservationQuantity > maximumQuantity) {
      setReservationMessageKind('error');
      setReservationMessage(`Enter an exact quantity between 1 and ${maximumQuantity}.`);
      return;
    }
    if (!prescriptionFile) {
      setReservationMessageKind('error');
      setReservationMessage('Choose a JPEG, PNG, or PDF prescription before submitting.');
      prescriptionInputRef.current?.focus();
      return;
    }

    setSubmittingPrescription(true);
    setReservationMessage(null);
    try {
      const formData = new FormData();
      formData.append('inventory_id', selectedItem.id);
      formData.append('quantity', String(reservationQuantity));
      formData.append('file', prescriptionFile);

      const response = await nativeFetch('/api/reservations/prescription', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error(reservationErrorMessage(response.status));

      setReservationMessageKind('success');
      setReservationMessage(
        `Prescription submitted for licensed pharmacist pre-review for ${selectedItem.pharmacies.pharmacy_name}. If a hold is authorized, a pickup code will be created; the pharmacy makes the final dispensing decision.`,
      );
      setPrescriptionSent(true);
      setPrescriptionFile(null);
      if (prescriptionInputRef.current) prescriptionInputRef.current.value = '';
    } catch (err) {
      if (isPatientAbort(err)) return;
      setReservationMessageKind('error');
      setReservationMessage(err instanceof Error ? err.message : 'We could not submit this reservation. Please try again.');
    } finally {
      setSubmittingPrescription(false);
    }
  };

  const selectedItemCanReserve = Boolean(
    selectedItem?.pharmacies.reservations_enabled
      && selectedItem.quantity_in_stock > 0
      && (!selectedItem.requires_prescription
        || selectedItem.pharmacies.digital_prescription_reservations_enabled === true),
  );

  if (loading) {
    return (
      <div className="w-full max-w-[1000px] mx-auto space-y-6">
        <div className="space-y-2">
          <div className="h-4 w-24 bg-surface rounded animate-pulse" />
          <div className="h-8 w-3/4 bg-surface rounded animate-pulse" />
          <div className="h-4 w-1/2 bg-surface rounded animate-pulse" />
        </div>

        <div className="space-y-4">
          <div className="h-4 w-32 bg-surface rounded animate-pulse" />
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="border border-border rounded-card p-5 bg-white flex justify-between items-center gap-4 shadow-xs"
            >
              <div className="flex-1 space-y-2.5">
                <div className="h-5 w-48 bg-surface rounded animate-pulse" />
                <div className="h-4 w-36 bg-surface rounded animate-pulse" />
                <div className="h-3 w-64 bg-surface rounded animate-pulse" />
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="h-6 w-20 bg-surface rounded-button animate-pulse" />
                <div className="h-6 w-16 bg-surface rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full max-w-[760px] mx-auto px-4 py-12 text-center">
        <div className="border border-red-200 bg-red-50/50 rounded-card-lg p-8 flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
            <WifiOff className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-medium text-ink">Connection Failed</h2>
          <p className="text-sm text-ink-muted max-w-md leading-relaxed">{error}</p>
          <Button
            onClick={() => void fetchResults()}
            className="mt-2 inline-flex items-center gap-2 bg-primary text-white text-sm font-medium px-5 py-2.5 rounded-button hover:bg-[var(--primary-hover)] transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Retry Search
          </Button>
        </div>
      </div>
    );
  }

  if (safetyRedirect) {
    const returnToChat = () => router.push('/chat');
    return (
      <div data-tour-blocked="true" className="w-full max-w-[1000px] mx-auto">
        {safetyRedirect.action === 'emergency' && (
          <EmergencyScreen onBack={returnToChat} userState={locationLabel} />
        )}
        {safetyRedirect.action === 'restricted' && (
          <RestrictedScreen onBack={returnToChat} />
        )}
        {safetyRedirect.action === 'crisis' && (
          <CrisisScreen onBack={returnToChat} />
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1000px] mx-auto">
      <Link
        href="/chat"
        className="inline-flex items-center gap-1.5 text-[14px] font-medium text-ink-muted mb-5 hover:text-ink transition-colors"
      >
        ← Back to chat
      </Link>
      <h1 className="font-display font-semibold text-[25px] sm:text-[30px] text-ink leading-tight">
        {query} near {locationLabel}
      </h1>
      <p className="text-[15px] font-normal text-ink-muted mt-2">
        {results.length} {results.length === 1 ? 'medicine listing' : 'medicine listings'} · compare nearby pharmacies
      </p>

      <div className="mt-6 rounded-card border border-border bg-white p-4 sm:p-6">
        {results.length ? (() => {
          const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, '');
          const normalizedQuery = normalize(query);
          const matchesQuery = (name: string | null | undefined, strength: string | null | undefined) =>
            Boolean(normalizedQuery && name && normalize(`${name} ${strength || ''}`).includes(normalizedQuery));
          const direct = results.filter(item => [item.brand_name, item.name].some(name => matchesQuery(name, item.strength)));
          const directIds = new Set(direct.map(item => item.id));
          const firstExactIngredient = direct.find(item => item.generic_name)?.generic_name;
          const generic = results.filter(item => {
            if (directIds.has(item.id) || !item.generic_name) return false;
            return matchesQuery(item.generic_name, item.strength) ||
              Boolean(firstExactIngredient && normalize(item.generic_name) === normalize(firstExactIngredient));
          });
          const genericIds = new Set(generic.map(item => item.id));
          const other = results.filter(item => !directIds.has(item.id) && !genericIds.has(item.id));
          const groups = [{ label: 'Direct matches', items: direct }, { label: 'Same active ingredient', items: generic }, { label: 'Other matches', items: other }].filter(group => group.items.length);
          return <div className="space-y-6">{groups.map(group => <section key={group.label} aria-label={group.label}>
            <h2 className="mb-3 text-sm font-semibold text-ink">{group.label}</h2>
            {group.label === 'Same active ingredient' && <p className="mb-3 text-xs leading-relaxed text-ink-muted">Ask a pharmacist whether an alternative matches your prescription, strength and dosage form.</p>}
            <div className="space-y-3">{group.items.map(item => {
              const stock = getStockInfo(item.quantity_in_stock, item.low_stock_threshold);
              const verified = item.pharmacies.verification_status === 'full' && item.pharmacies.is_verified;
              return <button key={item.id} type="button" data-tour="patient-result" onClick={() => handleOpenDetail(item)} className="flex w-full flex-col gap-3 rounded-button border border-border bg-white p-4 text-left transition-colors hover:border-primary/40 hover:bg-surface/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <div className="flex w-full flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-ink break-words">{item.pharmacies.pharmacy_name}</h3>
                    <p className="mt-1 text-sm text-ink">{item.brand_name || item.name} {item.strength}</p>
                  </div>
                  <span style={{ color: stock.badgeColor, backgroundColor: stock.badgeBg }} className="rounded-button px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap">{stock.label}</span>
                </div>
                <div className="flex w-full flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1 text-xs text-ink-muted">
                    <p className="flex gap-1.5"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>{item.pharmacies.address}{typeof item.distance_km === 'number' ? ` · ${item.distance_km.toFixed(1)} km away` : ''}</span></p>
                    {item.pharmacies.is_open_now != null && <p className={item.pharmacies.is_open_now ? 'font-medium text-success' : 'font-medium text-danger'}>{item.pharmacies.is_open_now ? 'Open now' : 'Closed now'}{item.pharmacies.operating_hours ? ` · ${item.pharmacies.operating_hours}` : ''}</p>}
                    {verified ? <span className="inline-flex items-center gap-1 font-medium text-success"><BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Fully verified</span> : <span className="font-medium text-warning">{item.pharmacies.verification_status === 'provisional' ? 'Provisional · evidence pending' : 'Verification not confirmed'}</span>}
                    <PomReservationMode item={item} />
                  </div>
                  <div className="text-right">
                    <p className="text-base font-semibold text-navy">{item.price ? `₦${Number(item.price).toLocaleString()}` : 'Ask pharmacy'}{item.price ? <span className="ml-1 text-xs font-normal text-ink-muted">/ pack</span> : null}</p>
                    <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary">View pharmacy <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
                  </div>
                </div>
              </button>;
            })}</div>
          </section>)}</div>;
        })() : <div className="py-12 text-center">
          <MapPin className="mx-auto mb-4 h-8 w-8 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-ink">No nearby matches right now</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">Try another area or check the spelling. You can also ask the assistant about another brand.</p>
          <Link href="/chat" className="mt-5 inline-flex min-h-11 items-center rounded-button bg-primary px-4 text-sm font-semibold text-white">Back to search</Link>
        </div>}
      </div>

      {/* Alternative suggestion banner */}
      <div className="mt-7 bg-[var(--surface)] border border-border rounded-card p-4 flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lightbulb className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </span>
        <p className="text-[14px] font-normal text-ink-muted leading-relaxed">
          Need a cheaper option? Ask StocMed to check for generic alternatives or brands with the same active ingredients.
        </p>
      </div>

      {/* Detail Modal Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent data-tour="patient-detail" role="dialog" aria-modal="true" aria-label={confirmedHold ? 'Pickup hold confirmed' : prescriptionSent ? 'Prescription sent for review' : 'Pharmacy details and pickup reservation'} onClose={() => setIsDetailOpen(false)} className="max-w-[500px] p-5 sm:p-6 rounded-card bg-white border border-border max-sm:mt-auto max-sm:mx-0 max-sm:rounded-b-none max-sm:max-h-[90dvh]">
          {selectedItem && (confirmedHold || prescriptionSent) ? (
            <div className="space-y-5 pt-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success"><CheckCircle2 className="h-6 w-6" aria-hidden="true" /></div>
              <div>
                <h2 className="text-xl font-semibold text-ink">{confirmedHold ? 'Hold confirmed' : 'Sent for review'}</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{confirmedHold ? 'Show this code at the pharmacy counter before your hold expires.' : 'The destination pharmacy’s superintendent pharmacist will review your prescription. No stock is held while it is pending.'}</p>
              </div>
              {confirmedHold && <div className="rounded-card bg-surface p-5 text-center"><p className="text-xs font-medium text-ink-muted">Your pickup code</p><p className="mt-2 font-mono text-3xl font-bold tracking-widest text-navy" aria-label={`Pickup code ${confirmedHold.pickupCode}`}>{confirmedHold.pickupCode}</p></div>}
              <dl className="divide-y divide-border text-sm">
                <div className="flex justify-between gap-4 py-3"><dt className="text-ink-muted">Medicine</dt><dd className="text-right font-medium text-ink">{selectedItem.brand_name || selectedItem.name} {selectedItem.strength} × {confirmedHold?.quantity || reservationQuantity}</dd></div>
                <div className="flex justify-between gap-4 py-3"><dt className="text-ink-muted">Pharmacy</dt><dd className="text-right font-medium text-ink">{selectedItem.pharmacies.pharmacy_name}</dd></div>
                {confirmedHold && <div className="flex justify-between gap-4 py-3"><dt className="text-ink-muted">Collect by</dt><dd className="text-right font-semibold text-ink"><time dateTime={confirmedHold.expiresAt}>{new Date(confirmedHold.expiresAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time></dd></div>}
                {confirmedHold && <div className="flex justify-between gap-4 py-3"><dt className="text-ink-muted">Pay at pickup</dt><dd className="font-semibold text-ink">{selectedItem.price ? `₦${(Number(selectedItem.price) * confirmedHold.quantity).toLocaleString()}` : 'Confirm with pharmacy'}</dd></div>}
              </dl>
              {prescriptionSent && <p className="rounded-button bg-surface p-3 text-sm leading-relaxed text-ink-muted">If a pickup hold is authorized, its code will appear in My holds. The pharmacy makes the final dispensing decision.</p>}
              <div className="flex flex-col sm:flex-row gap-3">
                {confirmedHold && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedItem.pharmacies.pharmacy_name}, ${selectedItem.pharmacies.address}`)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-button border border-primary px-4 text-sm font-semibold text-primary"><Navigation className="h-4 w-4" aria-hidden="true" /> Get directions</a>}
                <Link href="/reservations" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-button bg-primary px-4 text-sm font-semibold text-white">View my holds</Link>
              </div>
            </div>
          ) : selectedItem && (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="pr-6 text-xl font-semibold text-ink break-words">
                    {selectedItem.pharmacies.pharmacy_name}
                  </h2>
                  <p className="text-[14px] font-normal text-ink-muted mt-1.5">
                    {selectedItem.pharmacies.address}{' '}
                    {selectedItem.distance_km && `· ${selectedItem.distance_km.toFixed(1)} km away`}
                  </p>
                </div>
              </div>

              {/* Medication Card in Modal */}
              <div className="border border-border rounded-card p-4 flex items-center justify-between gap-3 w-full min-w-0">
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium text-ink truncate">
                    {selectedItem.brand_name || selectedItem.name} {selectedItem.strength}
                  </div>
                  <div className="text-[13px] text-ink-light mt-0.5">per pack</div>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0 text-right">
                  <span
                    style={{
                      color: getStockInfo(selectedItem.quantity_in_stock, selectedItem.low_stock_threshold).badgeColor,
                      backgroundColor: getStockInfo(selectedItem.quantity_in_stock, selectedItem.low_stock_threshold).badgeBg,
                    }}
                    className="text-[12px] font-medium px-2.5 py-1.5 rounded-button whitespace-nowrap"
                  >
                    {getStockInfo(selectedItem.quantity_in_stock, selectedItem.low_stock_threshold).label}
                  </span>
                  <span className="text-[18px] font-medium text-navy">
                    {selectedItem.price ? `₦${Number(selectedItem.price).toLocaleString()}` : 'Ask'}
                  </span>
                </div>
              </div>

              {/* Detail list */}
              <div className="flex flex-col gap-3.5">
                <div className="flex justify-between gap-4">
                  <span className="text-[14px] text-ink-light font-normal">Opening hours</span>
                  <span className="text-[14px] text-ink font-medium text-right">
                    {selectedItem.pharmacies.operating_hours || 'Not provided'}
                  </span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex justify-between gap-4">
                  <span className="text-[14px] text-ink-light font-normal">PCN license</span>
                  <span className="text-[14px] text-ink font-medium text-right">
                    <span className="block">{selectedItem.pharmacies.license_number || 'Not provided'}</span>
                    {selectedItem.pharmacies.verification_status === 'full' && selectedItem.pharmacies.is_verified ? (
                      <span className="mt-1 inline-flex items-center gap-1 text-success font-medium">
                        <BadgeCheck className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                        Fully verified
                      </span>
                    ) : (
                      <span className="mt-1 inline-flex text-xs font-medium text-warning">
                        {selectedItem.pharmacies.verification_status === 'provisional' ? 'Provisional · PCN evidence pending' : 'Verification not confirmed'}
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex justify-between gap-4">
                  <span className="text-[14px] text-ink-light font-normal">Phone</span>
                  <span className="text-[14px] text-ink font-medium text-right">
                    {selectedItem.pharmacies.phone || 'Unavailable'}
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              <div data-tour="patient-pharmacy-actions" className="flex flex-col gap-2 pt-2">
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedItem.pharmacies.pharmacy_name}, ${selectedItem.pharmacies.address}`)}`} target="_blank" rel="noreferrer" className="mb-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-button border border-border px-4 text-sm font-semibold text-primary"><Navigation className="h-4 w-4" aria-hidden="true" /> Get directions</a>
                {reservationMessage && (
                  <p
                    className={reservationMessageKind === 'error'
                      ? 'rounded-card border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'
                      : 'rounded-card border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800'}
                    role={reservationMessageKind === 'error' ? 'alert' : 'status'}
                    aria-live="polite"
                  >
                    {reservationMessage}
                  </p>
                )}

                {selectedItem.requires_prescription ? (
                  selectedItemCanReserve ? (
                    <form className="flex flex-col gap-4" onSubmit={handlePrescriptionReservation}>
                      <p id="prescription-guidance" className="text-[13px] leading-relaxed text-ink-muted">
                        Upload a clear prescription for this medicine and quantity. The destination pharmacy&apos;s superintendent pharmacist reviews the request before a pickup hold can be created.
                      </p>

                      <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-ink">
                          Prescription
                          <input
                            ref={prescriptionInputRef}
                            type="file"
                            accept="image/jpeg,image/png,application/pdf"
                            required
                            onChange={handlePrescriptionFileChange}
                            aria-describedby="prescription-guidance prescription-format-help"
                            className="min-w-0 rounded-button border border-border bg-white px-3 py-2 text-xs text-ink file:mr-3 file:rounded-button file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                          <span id="prescription-format-help" className="text-xs font-normal text-ink-light">
                            JPEG, PNG, or PDF · 5 MB maximum
                          </span>
                        </label>

                        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
                          Exact quantity
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={Math.min(10, selectedItem.quantity_in_stock)}
                            step={1}
                            required
                            value={reservationQuantity}
                            onChange={(event) => setReservationQuantity(Number(event.target.value))}
                            className="h-10 rounded-button border border-border px-3 text-right text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {selectedItem.pharmacies.phone ? (
                          <a
                            href={`tel:${selectedItem.pharmacies.phone}`}
                            className="flex h-12 items-center justify-center gap-2 rounded-button bg-primary px-3 text-center text-[14px] font-medium text-white transition-colors hover:bg-[var(--primary-hover)] focus:outline-none focus:ring-2 focus:ring-primary/30"
                            aria-label={`Call ${selectedItem.pharmacies.pharmacy_name}`}
                          >
                            <Phone className="h-4 w-4" aria-hidden="true" />
                            Call pharmacy
                          </a>
                        ) : (
                          <Button
                            type="button"
                            disabled
                            className="h-12 gap-2 rounded-button bg-primary px-3 text-[14px] font-medium text-white disabled:opacity-50"
                            aria-label="Call pharmacy; phone number unavailable"
                          >
                            <Phone className="h-4 w-4" aria-hidden="true" />
                            Call pharmacy
                          </Button>
                        )}
                        <Button
                          type="submit"
                          disabled={submittingPrescription}
                          className="h-12 rounded-button bg-primary px-3 text-[14px] font-medium text-white transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-60"
                        >
                          {submittingPrescription ? (
                            <span className="inline-flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                              Submitting…
                            </span>
                          ) : 'Send to pharmacist'}
                        </Button>
                      </div>

                      <p className="text-xs leading-relaxed text-ink-light">
                        Hold authorization creates a pickup code; it is not dispensing approval or a dispensing guarantee.
                        Final supply remains under the destination pharmacy&apos;s professional supervision.
                      </p>
                    </form>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <p className="text-sm leading-relaxed text-ink-muted">
                        {selectedItem.pharmacies.verification_status === 'provisional'
                          ? 'This pharmacy has provisional visibility, so prescription medicines are call-only until its evidence receives full review.'
                          : 'This pharmacy is not accepting digital prescription reservations for this item. You can still call about availability and the prescription process.'}
                      </p>
                      {selectedItem.pharmacies.phone ? (
                        <a
                          href={`tel:${selectedItem.pharmacies.phone}`}
                          className="flex h-12 w-full items-center justify-center gap-2 rounded-button bg-primary px-4 text-[15px] font-medium text-white transition-colors hover:bg-[var(--primary-hover)] focus:outline-none focus:ring-2 focus:ring-primary/30"
                          aria-label={`Call ${selectedItem.pharmacies.pharmacy_name}`}
                        >
                          <Phone className="h-5 w-5" aria-hidden="true" />
                          Call pharmacy
                        </a>
                      ) : (
                        <Button
                          type="button"
                          disabled
                          className="h-12 w-full gap-2 rounded-button bg-primary text-[15px] font-medium text-white disabled:opacity-50"
                          aria-label="Call pharmacy; phone number unavailable"
                        >
                          <Phone className="h-5 w-5" aria-hidden="true" />
                          Call pharmacy
                        </Button>
                      )}
                    </div>
                  )
                ) : (
                  <>
                    {selectedItemCanReserve && (
                      <>
                        <label className="flex items-center justify-between gap-3 text-sm text-ink-muted">
                          Quantity to hold (packs)
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={Math.min(10, selectedItem.quantity_in_stock)}
                            step={1}
                            value={reservationQuantity}
                            onChange={(event) => setReservationQuantity(Math.max(1, Math.min(Number(event.target.value) || 1, Math.min(10, selectedItem.quantity_in_stock))))}
                            className="h-9 w-20 rounded-button border border-border px-2 text-right text-ink"
                          />
                        </label>
                        <div className="rounded-button bg-surface p-3 text-sm">
                          <div className="flex justify-between gap-3"><span className="text-ink-muted">Estimated total</span><span className="font-semibold text-ink">{selectedItem.price ? `₦${(Number(selectedItem.price) * reservationQuantity).toLocaleString()}` : 'Ask pharmacy'}</span></div>
                          <p className="mt-2 text-xs leading-relaxed text-ink-muted">You pay at the pharmacy when you collect. Your pickup code and collection deadline appear after the hold is confirmed.</p>
                        </div>
                        <p className="text-xs leading-relaxed text-ink-muted">Placing this hold allows StocMed to send one text message to the phone number on your account with the pickup code and collection window.</p>
                      </>
                    )}

                    <div className="flex flex-col sm:flex-row gap-3">
                      {selectedItemCanReserve && (
                        <Button
                          onClick={handleReserve}
                          disabled={reserving}
                          className="h-12 flex-1 rounded-button bg-primary text-[15px] font-medium text-white transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-60"
                        >
                          {reserving ? 'Creating hold...' : 'Hold for pickup'}
                        </Button>
                      )}
                      {selectedItem.pharmacies.phone ? (
                        <a
                          href={`tel:${selectedItem.pharmacies.phone}`}
                          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-button border-[1.5px] border-primary px-3 text-[15px] font-medium text-primary transition-colors hover:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                          aria-label={`Call ${selectedItem.pharmacies.pharmacy_name}`}
                        >
                          <Phone className="h-5 w-5" aria-hidden="true" />
                          Call pharmacy
                        </a>
                      ) : (
                        <Button
                          type="button"
                          disabled
                          className="h-12 flex-1 gap-2 rounded-button border-[1.5px] border-primary bg-white text-[15px] font-medium text-primary disabled:opacity-50"
                          aria-label="Call pharmacy; phone number unavailable"
                        >
                          <Phone className="h-5 w-5" aria-hidden="true" />
                          Call pharmacy
                        </Button>
                      )}
                    </div>

                    <a
                      href={`https://chowdeck.com/search?q=${encodeURIComponent(selectedItem.brand_name || selectedItem.name)}&store=${encodeURIComponent(selectedItem.pharmacies.pharmacy_name)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-button px-3 text-xs font-medium text-primary underline underline-offset-2 hover:bg-surface"
                    >
                      <Truck className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                      <span>Search Chowdeck for delivery</span>
                    </a>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
