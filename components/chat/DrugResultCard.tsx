import { useState } from 'react';
import { Phone, MapPin, Clock, Package, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface DrugResultCardProps {
  drug: any; // API response from /api/drugs/search
}

export default function DrugResultCard({ drug }: DrugResultCardProps) {
  const [showDetails, setShowDetails] = useState(false);

  const pharmacy = drug.pharmacies;

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

  return (
    <Card className="p-4 mb-3 hover:shadow-md transition-shadow border border-gray-200">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        {drug.image_url && (
          <div className="h-16 w-16 shrink-0">
            <img
              src={drug.image_url}
              alt={drug.name || drug.brand_name || 'Drug image'}
              className="h-16 w-16 rounded-lg object-cover border border-gray-200"
            />
          </div>
        )}
        <div className="flex-1">
          <h3 className="font-semibold text-lg text-gray-900">
            {pharmacy.pharmacy_name}
          </h3>
          <p className="text-sm text-gray-600 flex items-center gap-1 mt-1">
            <MapPin className="h-3 w-3" />
            {pharmacy.address}, {pharmacy.city}, {pharmacy.state}
          </p>
        </div>
        {pharmacy.p2p_verified && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full">
            <ShieldCheck className="h-3 w-3" />
            Verified
          </span>
        )}
      </div>

      {/* Drug Information */}
      <div className="bg-gray-50 rounded-lg p-3 mb-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-900">
              {drug.name || drug.brand_name}
              {drug.strength && ` ${drug.strength}`}
            </p>
            {drug.generic_name && drug.name !== drug.generic_name && (
              <p className="text-sm text-gray-600">{drug.generic_name}</p>
            )}
            <p className="text-sm text-gray-600 capitalize">
              {drug.dosage_form}
            </p>
            {drug.manufacturer && (
              <p className="text-xs text-gray-500 mt-1">
                by {drug.manufacturer}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-primary-blue">
              ₦{drug.price ? drug.price.toLocaleString() : 'N/A'}
            </p>
            {drug.requires_prescription && (
              <p className="text-xs text-red-600 mt-1">Requires Prescription</p>
            )}
          </div>
        </div>
      </div>

      {/* Stock Status & Category */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium',
            getStockStatusColor(stockStatus)
          )}
        >
          <Package className="h-3 w-3" />
          {getStockStatusText(stockStatus)}
          {drug.quantity_in_stock > 0 && ` (${drug.quantity_in_stock} available)`}
        </span>
        {drug.category && (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-primary-blue">
            {drug.category}
          </span>
        )}
      </div>

      {/* Details Section (Expandable) */}
      {showDetails && (
        <div className="border-t border-gray-200 pt-3 mb-3">
          <div className="space-y-2 text-sm">
            <div>
              <span className="font-medium text-gray-700">Phone:</span>
              <span className="ml-2 text-gray-600">{pharmacy.phone}</span>
            </div>
            {pharmacy.operating_hours && (
              <div className="flex items-center text-gray-600 gap-2">
                <Clock className="h-4 w-4 text-gray-500" />
                <span className="text-sm">{pharmacy.operating_hours}</span>
              </div>
            )}
            <div>
              <span className="font-medium text-gray-700">Location:</span>
              <span className="ml-2 text-gray-600">
                {pharmacy.city}, {pharmacy.state}
              </span>
            </div>
            {drug.description && (
              <div>
                <span className="font-medium text-gray-700">Description:</span>
                <p className="mt-1 text-gray-600">{drug.description}</p>
              </div>
            )}
            {drug.expiry_date && (
              <div>
                <span className="font-medium text-gray-700">Expiry Date:</span>
                <span className="ml-2 text-gray-600">
                  {new Date(drug.expiry_date).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDetails(!showDetails)}
          className="flex-1"
        >
          {showDetails ? 'Hide Details' : 'View Details'}
        </Button>
        <Button
          size="sm"
          className="flex-1"
          asChild
        >
          <a href={`tel:${pharmacy.phone}`} className="flex items-center justify-center gap-2">
            <Phone className="h-4 w-4" />
            Call Pharmacy
          </a>
        </Button>
      </div>
    </Card>
  );
}
