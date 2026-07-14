import { useState, useEffect } from 'react';
import Image from 'next/image';
import {
  Phone,
  MapPin,
  Clock,
  Package,
  ShieldCheck,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface DrugResultCardProps {
  drug: any; // API response from /api/drugs/search
}

export default function DrugResultCard({ drug }: DrugResultCardProps) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [detailMessage, setDetailMessage] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  const pharmacy = drug.pharmacies;
  const priceMin = Number.isFinite(drug.price_range_min) ? drug.price_range_min : null;
  const priceMax = Number.isFinite(drug.price_range_max) ? drug.price_range_max : null;
  const distanceText =
    typeof drug.distance_km === 'number' && Number.isFinite(drug.distance_km)
      ? `${drug.distance_km} km away`
      : null;

  // Calculate stock status
  const getStockStatus = () => {
    if (!drug.quantity_in_stock || drug.quantity_in_stock === 0) {
      return 'out-of-stock';
    }
    if (drug.quantity_in_stock <= (drug.low_stock_threshold || 10)) {
      return 'low-stock';
    }
    return 'in-stock';
  };

  const stockStatus = getStockStatus();

  const getStockStatusColor = (status: string) => {
    switch (status) {
      case 'in-stock':
        return 'text-success bg-success/5 border border-success/20';
      case 'low-stock':
        return 'text-warning bg-warning/5 border border-warning/20';
      case 'out-of-stock':
        return 'text-danger bg-danger/5 border border-danger/20';
      default:
        return 'text-muted-foreground bg-surface border border-border';
    }
  };

  const getStockStatusText = (status: string) => {
    switch (status) {
      case 'in-stock':
        return 'In Stock';
      case 'low-stock':
        return 'Low Stock';
      case 'out-of-stock':
        return 'Out of Stock';
      default:
        return 'Unknown';
    }
  };

  useEffect(() => {
    if (!pharmacy) {
      return;
    }

    if (!isDetailOpen || detailMessage || detailError || isDetailLoading) {
      return;
    }

    let isMounted = true;

    const fetchAssistantDetails = async () => {
      try {
        setIsDetailLoading(true);
        setDetailError(null);
        const drugName =
          drug.name || drug.brand_name || drug.generic_name || 'this medication';
        const response = await fetch('/api/chat/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation: [
              {
                role: 'user',
                content: `Provide a short, patient-friendly overview for ${drugName}. Include typical uses, precautions, and when a pharmacist consultation is needed.`,
              },
            ],
            query: drugName,
            pharmacies: [drug],
            userLocation: null,
          }),
        });

        if (!isMounted) return;

        const data = await response.json();
        if (typeof data?.message === 'string') {
          setDetailMessage(data.message);
        } else {
          setDetailError('No additional insights are available for this medication.');
        }
      } catch (error) {
        console.error('Detail assistant error:', error);
        if (isMounted) {
          setDetailError('Unable to load assistant insights right now.');
        }
      } finally {
        if (isMounted) {
          setIsDetailLoading(false);
        }
      }
    };

    const timer = setTimeout(() => {
      fetchAssistantDetails();
    }, 150);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [detailError, detailMessage, drug, isDetailLoading, isDetailOpen, pharmacy]);

  if (!pharmacy) {
    return null; // Don't render if pharmacy data is missing
  }

  return (
    <>
    <Card className="min-w-[310px] max-w-xs snap-start flex flex-col justify-between border border-border hover:shadow-md transition-all duration-250 bg-card">
      <div className="p-4 space-y-4">
        <div className="flex items-start gap-2.5">
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              {pharmacy.logo_url ? (
                <Image
                  src={pharmacy.logo_url}
                  alt={`${pharmacy.pharmacy_name} logo`}
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-full border border-border object-cover"
                  unoptimized
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold flex-shrink-0">
                  {pharmacy.pharmacy_name?.charAt(0)?.toUpperCase() || 'P'}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink leading-tight truncate">
                  {pharmacy.pharmacy_name}
                </p>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pharmacy</p>
              </div>
              {(pharmacy.p2p_verified || pharmacy.license_number) && (
                <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-bold text-success bg-success/10 border border-success/20 px-1.5 py-0.5 rounded-full flex-shrink-0">
                  <ShieldCheck className="h-2.5 w-2.5" />
                  PCN Checked
                </span>
              )}
            </div>
            
            <p className="text-xs text-muted-foreground flex items-start gap-1 leading-snug">
              <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0 text-muted-foreground/60" />
              <span className="line-clamp-2">
                {pharmacy.address}
                {pharmacy.city ? `, ${pharmacy.city}` : ''}
              </span>
            </p>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {distanceText && (
                <span className="font-semibold text-ink">{distanceText}</span>
              )}
              {distanceText && pharmacy.operating_hours && <span>•</span>}
              {pharmacy.operating_hours && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3 text-muted-foreground/60" />
                  {pharmacy.operating_hours}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="bg-surface rounded-lg p-3 space-y-2 border border-border/40">
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink leading-tight truncate">
                {drug.name || drug.brand_name}
                {drug.strength ? ` ${drug.strength}` : ''}
              </p>
              {drug.generic_name && drug.name !== drug.generic_name && (
                <p className="text-xs text-muted-foreground truncate">
                  Generic: {drug.generic_name}
                </p>
              )}
              <p className="text-xs text-muted-foreground capitalize">
                {drug.dosage_form || 'Dosage form not set'}
              </p>
            </div>
            
            <div className="text-right flex-shrink-0">
              {priceMin !== null && priceMax !== null ? (
                <>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Est. price
                  </p>
                  <p className="text-sm font-bold text-primary tabular-nums font-mono">
                    ₦{priceMin.toLocaleString()} - ₦{priceMax.toLocaleString()}
                  </p>
                </>
              ) : (
                <p className="text-sm font-bold text-primary tabular-nums font-mono">
                  ₦{drug.price ? Number(drug.price).toLocaleString() : 'Ask'}
                </p>
              )}
              {drug.requires_prescription && (
                <span className="inline-block text-[9px] font-bold uppercase tracking-wider text-danger bg-danger/10 border border-danger/20 px-1 rounded mt-1">
                  Rx Required
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            <span
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold',
                getStockStatusColor(stockStatus)
              )}
            >
              <Package className="h-3 w-3" />
              {getStockStatusText(stockStatus)}
              {drug.quantity_in_stock > 0 &&
                ` (${drug.quantity_in_stock})`}
            </span>
            {(drug.quantity_in_stock ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-success/10 text-success border border-success/20">
                <Clock className="h-3 w-3" />
                Ready
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 pb-4 pt-0 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsDetailOpen(true)}
          className="flex-1 text-xs border-border hover:bg-surface"
        >
          View details
        </Button>
        <Button size="sm" asChild className="flex-1 text-xs shadow-sm">
          <a
            href={pharmacy.phone ? `tel:${pharmacy.phone}` : '#'}
            className="flex items-center justify-center gap-1.5"
            aria-disabled={!pharmacy.phone}
          >
            <Phone className="h-3.5 w-3.5" />
            Call Outlet
          </a>
        </Button>
      </div>
    </Card>
    <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">
            {drug.name || drug.brand_name}
            {drug.strength ? ` • ${drug.strength}` : ''}
          </DialogTitle>
          <DialogDescription>
            {pharmacy.pharmacy_name} •{' '}
            {distanceText ? `${distanceText} • ` : ''}
            {pharmacy.address}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:gap-6">
            <div className="flex items-center gap-3">
              {pharmacy.logo_url ? (
                <Image
                  src={pharmacy.logo_url}
                  alt={`${pharmacy.pharmacy_name} logo`}
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-full border border-border object-cover"
                  unoptimized
                />
              ) : (
                <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-semibold">
                  {pharmacy.pharmacy_name?.charAt(0)?.toUpperCase() || 'P'}
                </div>
              )}
              <div>
                <p className="font-semibold text-ink">
                  {pharmacy.pharmacy_name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {pharmacy.address}
                  {pharmacy.city ? `, ${pharmacy.city}` : ''}
                  {pharmacy.state ? `, ${pharmacy.state}` : ''}
                </p>
                {distanceText && (
                  <p className="text-xs text-muted-foreground">{distanceText}</p>
                )}
              </div>
            </div>
            {drug.image_url && (
              <Image
                src={drug.image_url}
                alt={drug.name || drug.brand_name || 'Drug image'}
                width={112}
                height={112}
                className="mt-4 sm:mt-0 h-28 w-28 rounded-lg border border-border object-cover"
                unoptimized
              />
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-card border border-border p-4 space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Price range
              </p>
              <p className="text-2xl font-bold text-primary">
                {priceMin !== null && priceMax !== null
                  ? `₦${priceMin.toLocaleString()} – ₦${priceMax.toLocaleString()}`
                  : drug.price
                  ? `₦${Number(drug.price).toLocaleString()}`
                  : 'Ask in-store'}
              </p>
              {drug.requires_prescription && (
                <p className="text-xs text-danger">
                  Prescription required
                </p>
              )}
            </div>
            <div className="rounded-card border border-border p-4 space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Stock information
              </p>
              <div
                className={cn(
                  'inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium',
                  getStockStatusColor(stockStatus)
                )}
              >
                <Package className="h-4 w-4" />
                {getStockStatusText(stockStatus)}
                {drug.quantity_in_stock > 0 &&
                  ` • ${drug.quantity_in_stock} units`}
              </div>
              {pharmacy.operating_hours && (
                <p className="text-xs text-muted-foreground">
                  Hours: {pharmacy.operating_hours}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-3 rounded-card border border-border p-4 bg-surface">
            <p className="text-sm font-semibold text-ink">
              Medication details
            </p>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1.5">
              <li>Form: {drug.dosage_form || 'Not specified'}</li>
              <li>
                Manufacturer:{' '}
                {drug.manufacturer || 'Not specified by the pharmacy'}
              </li>
              {drug.generic_name && (
                <li>Generic name: {drug.generic_name}</li>
              )}
              {drug.expiry_date && (
                <li>
                  Expiry:{' '}
                  {new Date(drug.expiry_date).toLocaleDateString()}
                </li>
              )}
              {drug.category && <li>Category: {drug.category}</li>}
            </ul>
            {drug.description && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                Notes: {drug.description}
              </p>
            )}

            {(isDetailLoading || detailMessage || detailError) && (
              <div className="mt-4 rounded-card border border-border bg-card p-3 sm:p-4">
                <p className="text-sm font-semibold text-ink">
                  Assistant insights
                </p>
                <div className="mt-2 text-sm text-muted-foreground whitespace-pre-line">
                  {isDetailLoading && 'Fetching tailored guidance...'}
                  {!isDetailLoading && detailError && (
                    <span className="text-danger">{detailError}</span>
                  )}
                  {!isDetailLoading && !detailError && detailMessage}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <Button
              size="sm"
              asChild
              className="w-full sm:w-auto bg-primary hover:bg-primary/90"
            >
              <a
                href={pharmacy.phone ? `tel:${pharmacy.phone}` : '#'}
                className="flex items-center justify-center gap-2"
                aria-disabled={!pharmacy.phone}
              >
                <Phone className="h-4 w-4" />
                Call {pharmacy.pharmacy_name || 'pharmacy'}
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">
              Tip: Call ahead to confirm stock or schedule pickup. Always
              follow your prescriber’s instructions.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
