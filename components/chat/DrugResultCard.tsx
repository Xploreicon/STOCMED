import { useState } from 'react';
import { Phone, MapPin, Clock, Package } from 'lucide-react';
import type { DrugAvailability } from '@/types/drug';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface DrugResultCardProps {
  result: DrugAvailability;
}

export function DrugResultCard({ result }: DrugResultCardProps) {
  const [showDetails, setShowDetails] = useState(false);

  const { drug, pharmacy, price, stockStatus, quantity } = result;

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

  return (
    <Card className="p-4 mb-3 hover:shadow-md transition-shadow border border-gray-200">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="font-semibold text-lg text-gray-900">
            {pharmacy.name}
          </h3>
          <p className="text-sm text-gray-600 flex items-center gap-1 mt-1">
            <MapPin className="h-3 w-3" />
            {pharmacy.address}
            {pharmacy.distance && (
              <span className="text-primary-blue ml-1">• {pharmacy.distance}</span>
            )}
          </p>
        </div>
        {pharmacy.rating && (
          <div className="flex items-center gap-1 bg-blue-50 px-2 py-1 rounded">
            <span className="text-yellow-500">★</span>
            <span className="text-sm font-medium">{pharmacy.rating}</span>
          </div>
        )}
      </div>

      {/* Drug Information */}
      <div className="bg-gray-50 rounded-lg p-3 mb-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-900">
              {drug.name} {drug.strength}
            </p>
            <p className="text-sm text-gray-600 capitalize">{drug.form}</p>
            {drug.manufacturer && (
              <p className="text-xs text-gray-500 mt-1">
                by {drug.manufacturer}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-primary-blue">
              ₦{price.toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* Stock Status & Availability */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium',
            getStockStatusColor(stockStatus)
          )}
        >
          <Package className="h-3 w-3" />
          {getStockStatusText(stockStatus)}
          {quantity && stockStatus !== 'out-of-stock' && ` (${quantity})`}
        </span>
        {pharmacy.isOpen !== undefined && (
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium',
              pharmacy.isOpen
                ? 'text-green-600 bg-green-50'
                : 'text-gray-600 bg-gray-50'
            )}
          >
            <Clock className="h-3 w-3" />
            {pharmacy.isOpen ? 'Open Now' : 'Closed'}
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
            <div>
              <span className="font-medium text-gray-700">Location:</span>
              <span className="ml-2 text-gray-600">{pharmacy.location}</span>
            </div>
            {result.lastUpdated && (
              <div>
                <span className="font-medium text-gray-700">Last Updated:</span>
                <span className="ml-2 text-gray-600">
                  {new Date(result.lastUpdated).toLocaleString()}
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
