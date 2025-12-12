import { useState, useEffect } from 'react';
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
        return 'text-green-600 bg-green-50';
      case 'low-stock':
        return 'text-orange-600 bg-orange-50';
      case 'out-of-stock':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-gray-600 bg-gray-50';
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

  if (!pharmacy) {
    return null; // Don't render if pharmacy data is missing
  }

  useEffect(() => {
    let isMounted = true;

    const fetchAssistantDetails = async () => {
      setIsDetailLoading(true);
      setDetailError(null);
      try {
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

        if (!response.ok) {
          setDetailError('Unable to load assistant insights right now.');
          return;
        }

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

    if (isDetailOpen && !detailMessage && !detailError && !isDetailLoading) {
      fetchAssistantDetails();
    }

    return () => {
      isMounted = false;
    };
  }, [isDetailOpen, detailMessage, detailError, isDetailLoading, drug.id]);

  return (
    <>
    <Card className="min-w-[320px] max-w-xs snap-start flex flex-col justify-between border border-gray-200 hover:shadow-md transition-shadow">
      <div className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              {pharmacy.logo_url ? (
                <img
                  src={pharmacy.logo_url}
                  alt={`${pharmacy.pharmacy_name} logo`}
                  className="h-8 w-8 rounded-full border border-gray-200 object-cover"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-blue-50 text-primary-blue flex items-center justify-center text-sm font-semibold">
                  {pharmacy.pharmacy_name?.charAt(0)?.toUpperCase() || 'P'}
                </div>
              )}
              <div>
                <p className="font-semibold text-gray-900 leading-tight">
                  {pharmacy.pharmacy_name}
                </p>
                <p className="text-xs text-gray-500">Pharmacy</p>
              </div>
              {pharmacy.p2p_verified && (
                <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full">
                  <ShieldCheck className="h-3 w-3" />
                  Verified
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600 flex items-start gap-1 leading-snug">
              <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <span>
                {pharmacy.address}
                {pharmacy.city ? `, ${pharmacy.city}` : ''}
                {pharmacy.state ? `, ${pharmacy.state}` : ''}
              </span>
            </p>
            {distanceText && (
              <p className="text-xs text-gray-500">{distanceText}</p>
            )}
          </div>
          {drug.image_url && (
            <img
              src={drug.image_url}
              alt={drug.name || drug.brand_name || 'Drug image'}
              className="h-16 w-16 rounded-lg object-cover border border-gray-200"
            />
          )}
        </div>

        <div className="bg-gray-50 rounded-lg p-3 space-y-2">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-semibold text-gray-900 leading-tight">
                {drug.name || drug.brand_name}
                {drug.strength ? ` ${drug.strength}` : ''}
              </p>
              {drug.generic_name && drug.name !== drug.generic_name && (
                <p className="text-xs text-gray-600">
                  Generic: {drug.generic_name}
                </p>
              )}
              <p className="text-xs text-gray-500 capitalize">
                {drug.dosage_form || 'Dosage form not set'}
              </p>
              {drug.manufacturer && (
                <p className="text-[11px] text-gray-400">
                  by {drug.manufacturer}
                </p>
              )}
            </div>
            <div className="text-right">
              {priceMin !== null && priceMax !== null ? (
                <>
                  <p className="text-[11px] uppercase tracking-wide text-gray-400">
                    Est. price
                  </p>
                  <p className="text-lg font-semibold text-primary-blue">
                    ₦{priceMin.toLocaleString()} - ₦{priceMax.toLocaleString()}
                  </p>
                </>
              ) : (
                <p className="text-lg font-semibold text-primary-blue">
                  ₦{drug.price ? Number(drug.price).toLocaleString() : 'Ask'}
                </p>
              )}
              {drug.requires_prescription && (
                <p className="text-[11px] text-red-600 mt-1">
                  Requires prescription
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium',
                getStockStatusColor(stockStatus)
              )}
            >
              <Package className="h-3 w-3" />
              {getStockStatusText(stockStatus)}
              {drug.quantity_in_stock > 0 &&
                ` (${drug.quantity_in_stock} available)`}
            </span>
            {(drug.quantity_in_stock ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-600">
                <Clock className="h-3 w-3" />
                Ready for pickup
              </span>
            )}
            {drug.category && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium bg-blue-50 text-primary-blue">
                <Info className="h-3 w-3" />
                {drug.category}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 pb-4 pt-0 flex flex-col gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsDetailOpen(true)}
          className="w-full"
        >
          View details
        </Button>
        <Button size="sm" asChild className="w-full">
          <a
            href={pharmacy.phone ? `tel:${pharmacy.phone}` : '#'}
            className="flex items-center justify-center gap-2"
            aria-disabled={!pharmacy.phone}
          >
            <Phone className="h-4 w-4" />
            Call Pharmacy
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
                <img
                  src={pharmacy.logo_url}
                  alt={`${pharmacy.pharmacy_name} logo`}
                  className="h-12 w-12 rounded-full border border-gray-200 object-cover"
                />
              ) : (
                <div className="h-12 w-12 rounded-full bg-blue-50 text-primary-blue flex items-center justify-center text-lg font-semibold">
                  {pharmacy.pharmacy_name?.charAt(0)?.toUpperCase() || 'P'}
                </div>
              )}
              <div>
                <p className="font-semibold text-gray-900">
                  {pharmacy.pharmacy_name}
                </p>
                <p className="text-sm text-gray-600">
                  {pharmacy.address}
                  {pharmacy.city ? `, ${pharmacy.city}` : ''}
                  {pharmacy.state ? `, ${pharmacy.state}` : ''}
                </p>
                {distanceText && (
                  <p className="text-xs text-gray-500">{distanceText}</p>
                )}
              </div>
            </div>
            {drug.image_url && (
              <img
                src={drug.image_url}
                alt={drug.name || drug.brand_name || 'Drug image'}
                className="mt-4 sm:mt-0 h-28 w-28 rounded-lg border border-gray-200 object-cover"
              />
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-lg border border-gray-200 p-4 space-y-2">
              <p className="text-xs font-semibold uppercase text-gray-500">
                Price range
              </p>
              <p className="text-2xl font-bold text-primary-blue">
                {priceMin !== null && priceMax !== null
                  ? `₦${priceMin.toLocaleString()} – ₦${priceMax.toLocaleString()}`
                  : drug.price
                  ? `₦${Number(drug.price).toLocaleString()}`
                  : 'Ask in-store'}
              </p>
              {drug.requires_prescription && (
                <p className="text-xs text-red-600">
                  Prescription required
                </p>
              )}
            </div>
            <div className="rounded-lg border border-gray-200 p-4 space-y-2">
              <p className="text-xs font-semibold uppercase text-gray-500">
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
                <p className="text-xs text-gray-600">
                  Hours: {pharmacy.operating_hours}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-gray-200 p-4 bg-gray-50">
            <p className="text-sm font-semibold text-gray-900">
              Medication details
            </p>
            <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1.5">
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
              <p className="text-sm text-gray-600 leading-relaxed">
                Notes: {drug.description}
              </p>
            )}

            {(isDetailLoading || detailMessage || detailError) && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3 sm:p-4">
                <p className="text-sm font-semibold text-gray-900">
                  Assistant insights
                </p>
                <div className="mt-2 text-sm text-gray-700 whitespace-pre-line">
                  {isDetailLoading && 'Fetching tailored guidance...'}
                  {!isDetailLoading && detailError && (
                    <span className="text-red-600">{detailError}</span>
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
              className="w-full sm:w-auto bg-primary-blue hover:bg-primary-blue/90"
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
            <p className="text-xs text-gray-500">
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
