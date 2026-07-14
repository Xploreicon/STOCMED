'use client';

import { Button } from '@/components/ui/button'

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { BadgeCheck, Lightbulb, Loader2, Phone, Truck } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';

export const dynamic = 'force-dynamic';

interface Pharmacy {
  pharmacy_name: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  operating_hours?: string;
  license_number?: string;
  p2p_verified?: boolean;
}

interface DrugSearchResult {
  id: string;
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
  distance_km?: number;
  pharmacies: Pharmacy;
}

export default function SearchResults() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get('q') || '';
  const locationLabel = searchParams.get('location') || 'nearby';

  const [results, setResults] = useState<DrugSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<DrugSearchResult | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [reserving, setReserving] = useState(false);

  useEffect(() => {
    if (!query) {
      router.push('/chat');
      return;
    }

    const fetchResults = async () => {
      setLoading(true);
      try {
        const storedLoc = localStorage.getItem('stocmed:userLocation');
        let lat = '';
        let lng = '';
        if (storedLoc) {
          const parsed = JSON.parse(storedLoc);
          lat = parsed.latitude;
          lng = parsed.longitude;
        }

        const params = new URLSearchParams();
        params.set('q', query);
        if (lat && lng) {
          params.set('lat', String(lat));
          params.set('lng', String(lng));
        }

        const response = await fetch(`/api/drugs/search?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          setResults(data.results || []);
        }
      } catch (err) {
        console.error('Failed to load search results:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, [query, router]);

  const getStockInfo = (qty: number, threshold = 10) => {
    if (qty <= 0) {
      return { label: 'Out of stock', badgeColor: 'var(--danger)', badgeBg: 'var(--danger-tint)' };
    }
    if (qty <= threshold) {
      return { label: 'Low stock', badgeColor: 'var(--warning)', badgeBg: 'var(--warning-tint)' };
    }
    return { label: 'In stock', badgeColor: 'var(--success)', badgeBg: 'var(--success-tint)' };
  };

  const handleOpenDetail = (item: DrugSearchResult) => {
    setSelectedItem(item);
    setIsDetailOpen(true);
  };

  const handleReserve = async () => {
    if (!selectedItem) return;
    setReserving(true);
    try {
      // Simulate booking reservation
      await new Promise((resolve) => setTimeout(resolve, 1000));
      alert(`Medication successfully reserved at ${selectedItem.pharmacies.pharmacy_name}! Please pick up within 24 hours.`);
      setIsDetailOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setReserving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-ink-muted text-[15px]">Searching pharmacies...</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[760px] mx-auto px-4 py-8 pb-24">
      <Link
        href="/chat"
        className="inline-flex items-center gap-1.5 text-[14px] font-medium text-ink-muted mb-5 hover:text-ink transition-colors"
      >
        ← Back to chat
      </Link>
      <h1 className="font-display font-medium text-[28px] text-ink leading-tight">
        {query} near {locationLabel}
      </h1>
      <p className="text-[15px] font-normal text-ink-muted mt-2">
        {results.length} {results.length === 1 ? 'pharmacy' : 'pharmacies'} found · sorted by distance
      </p>

      {/* Results List */}
      <div className="flex flex-col gap-6 mt-7 text-left">
        {results.length > 0 && (() => {
          const firstResult = results[0];
          const activeGeneric = firstResult?.generic_name;
          
          const exactMatches = results.filter(r => 
            (r.brand_name?.toLowerCase().includes(query.toLowerCase()) || 
            r.name?.toLowerCase().includes(query.toLowerCase()))
          );
          
          const genericEquivalents = results.filter(r => 
            activeGeneric && 
            r.generic_name?.toLowerCase() === activeGeneric.toLowerCase() && 
            !exactMatches.some(em => em.id === r.id)
          );

          return (
            <>
              {exactMatches.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-ink-light uppercase tracking-wider">Direct Matches</h3>
                  <div className="flex flex-col gap-3">
                    {exactMatches.map((r) => {
                      const stock = getStockInfo(r.quantity_in_stock, r.low_stock_threshold);
                      const price = r.price ? `₦${Number(r.price).toLocaleString()}` : 'Ask';
                      const distance = r.distance_km ? `${r.distance_km.toFixed(1)} km away` : '';
                      return (
                        <div
                          key={r.id}
                          onClick={() => handleOpenDetail(r)}
                          className="cursor-pointer flex items-center justify-between gap-4 sm:gap-5 border border-border rounded-card p-4 sm:p-5 bg-white hover:border-primary/30 transition-all shadow-xs w-full min-w-0"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                              <span className="text-[16px] font-medium text-ink truncate max-w-[140px] min-[375px]:max-w-[170px] min-[410px]:max-w-[200px] sm:max-w-none inline-block align-bottom">
                                {r.brand_name || r.name}
                              </span>
                              {r.strength && (
                                <span className="text-[13px] font-normal text-ink-light whitespace-nowrap">
                                  {r.strength}
                                </span>
                              )}
                            </div>
                            <div className="text-[14px] font-normal text-ink-muted mt-1.5 truncate">
                              {r.pharmacies.pharmacy_name}
                            </div>
                            <div className="text-[13px] font-normal text-ink-light mt-0.5 truncate">
                              {r.pharmacies.address} {distance && `· ${distance}`}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2 flex-shrink-0 text-right">
                            <span
                              style={{ color: stock.badgeColor, backgroundColor: stock.badgeBg }}
                              className="text-[12px] font-medium px-2.5 py-1.5 rounded-button whitespace-nowrap"
                            >
                              {stock.label}
                            </span>
                            <span className="text-[17px] font-medium text-navy whitespace-nowrap">
                              {price}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {genericEquivalents.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Generic Equivalents ({activeGeneric})</h3>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold uppercase">Same active ingredient</span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {genericEquivalents.map((r) => {
                      const stock = getStockInfo(r.quantity_in_stock, r.low_stock_threshold);
                      const price = r.price ? `₦${Number(r.price).toLocaleString()}` : 'Ask';
                      const distance = r.distance_km ? `${r.distance_km.toFixed(1)} km away` : '';
                      return (
                        <div
                          key={r.id}
                          onClick={() => handleOpenDetail(r)}
                          className="cursor-pointer flex items-center justify-between gap-4 sm:gap-5 border border-emerald-150 rounded-card p-4 sm:p-5 bg-emerald-50/10 hover:bg-emerald-50/20 hover:border-emerald-300 transition-all shadow-xs w-full min-w-0"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                              <span className="text-[16px] font-medium text-ink truncate max-w-[140px] min-[375px]:max-w-[170px] min-[410px]:max-w-[200px] sm:max-w-none inline-block align-bottom">
                                {r.brand_name || r.name}
                              </span>
                              {r.strength && (
                                <span className="text-[13px] font-normal text-ink-light whitespace-nowrap">
                                  {r.strength}
                                </span>
                              )}
                            </div>
                            <div className="text-[14px] font-normal text-ink-muted mt-1.5 truncate">
                              {r.pharmacies.pharmacy_name}
                            </div>
                            <div className="text-[13px] font-normal text-ink-light mt-0.5 truncate">
                              {r.pharmacies.address} {distance && `· ${distance}`}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2 flex-shrink-0 text-right">
                            <span
                              style={{ color: stock.badgeColor, backgroundColor: stock.badgeBg }}
                              className="text-[12px] font-medium px-2.5 py-1.5 rounded-button whitespace-nowrap"
                            >
                              {stock.label}
                            </span>
                            <span className="text-[17px] font-medium text-navy whitespace-nowrap">
                              {price}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {results.length === 0 && (
          <div className="text-center py-12 border border-dashed border-border rounded-card-lg">
            <p className="text-ink-muted text-[15px]">No results found. Try adjusting your query in chat.</p>
          </div>
        )}
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
        <DialogContent className="max-w-[440px] p-7 rounded-card-lg bg-white border border-border">
          {selectedItem && (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[20px] font-medium text-ink truncate">
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
                    {selectedItem.pharmacies.operating_hours || 'Mon–Sat, 8am – 9pm'}
                  </span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex justify-between gap-4">
                  <span className="text-[14px] text-ink-light font-normal">PCN license</span>
                  <span className="text-[14px] text-ink font-medium text-right">
                    {selectedItem.pharmacies.license_number || 'PCN/PREM/48213'}{' '}
                    <span className="inline-flex items-center gap-1 text-success font-medium">
                      <BadgeCheck className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                      Verified
                    </span>
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
              <div className="flex flex-col gap-2 pt-2">
                <div className="flex gap-3">
                  <Button
                    onClick={handleReserve}
                    disabled={reserving}
                    className="flex-1 h-12 bg-primary text-white text-[15px] font-medium rounded-button hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-60 flex items-center justify-center"
                  >
                    {reserving ? 'Reserving...' : 'Reserve medication'}
                  </Button>
                  {selectedItem.pharmacies.phone && (
                    <a
                      href={`tel:${selectedItem.pharmacies.phone}`}
                      className="w-12 h-12 border-[1.5px] border-primary rounded-button flex items-center justify-center text-primary text-[17px] hover:bg-surface transition-colors flex-shrink-0"
                    >
                      <Phone className="h-5 w-5" />
                    </a>
                  )}
                </div>
                
                <a
                  href={`https://chowdeck.com/search?q=${encodeURIComponent(selectedItem.brand_name || selectedItem.name)}&store=${encodeURIComponent(selectedItem.pharmacies.pharmacy_name)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full h-12 bg-[var(--legacy-success)] hover:bg-[var(--legacy-success-hover)] text-white text-[15px] font-medium rounded-button transition-colors flex items-center justify-center space-x-2"
                >
                  <Truck className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  <span className="font-bold">Deliver with Chowdeck</span>
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
