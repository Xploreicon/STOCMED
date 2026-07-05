'use client';

import { useState, useEffect } from 'react';
import { Search, MapPin, ShieldCheck, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface PharmacyMockResult {
  name: string;
  distance: string;
  price: string;
  stock: 'in-stock' | 'low-stock' | 'out-of-stock';
  quantity: number;
  verified: boolean;
}

const MOCK_DRUGS = [
  {
    name: 'Amatem Softgel 80/480mg',
    dosage: 'Dosage: 1 softgel daily',
    results: [
      { name: 'MedPlus Pharmacy', distance: '1.2 km away', price: '₦4,500', stock: 'in-stock', quantity: 45, verified: true },
      { name: 'HealthPlus Victoria Island', distance: '2.8 km away', price: '₦4,800', stock: 'low-stock', quantity: 5, verified: true },
      { name: 'Beko Pharmacy Ikeja', distance: '8.4 km away', price: '₦4,300', stock: 'in-stock', quantity: 80, verified: false }
    ] as PharmacyMockResult[]
  },
  {
    name: 'Amoxil Capsules 500mg',
    dosage: 'Dosage: 3 times daily',
    results: [
      { name: 'MedPlus Pharmacy', distance: '1.2 km away', price: '₦2,200', stock: 'in-stock', quantity: 120, verified: true },
      { name: 'Alpha Pharmacy & Stores', distance: '4.1 km away', price: '₦2,100', stock: 'in-stock', quantity: 95, verified: true },
      { name: 'HealthPlus Victoria Island', distance: '2.8 km away', price: '₦2,400', stock: 'low-stock', quantity: 3, verified: true }
    ] as PharmacyMockResult[]
  },
  {
    name: 'Glucophage 500mg (Metformin)',
    dosage: 'Dosage: 1-2 tablets daily',
    results: [
      { name: 'Alpha Pharmacy & Stores', distance: '4.1 km away', price: '₦3,800', stock: 'in-stock', quantity: 50, verified: true },
      { name: 'MedPlus Pharmacy', distance: '1.2 km away', price: '₦4,000', stock: 'low-stock', quantity: 8, verified: true },
      { name: 'HealthPlus Victoria Island', distance: '2.8 km away', price: '₦4,200', stock: 'out-of-stock', quantity: 0, verified: true }
    ] as PharmacyMockResult[]
  }
];

export default function MockSearchWidget() {
  const [selectedDrugIndex, setSelectedDrugIndex] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showResults, setShowResults] = useState(true);

  const activeDrug = MOCK_DRUGS[selectedDrugIndex];

  useEffect(() => {
    let timer: NodeJS.Timeout;
    const triggerSearchCycle = async () => {
      // Transition to next drug
      setIsTyping(true);
      setShowResults(false);
      
      const targetName = MOCK_DRUGS[(selectedDrugIndex + 1) % MOCK_DRUGS.length].name;
      let currentText = '';
      
      // Type animation
      for (let i = 0; i <= targetName.length; i++) {
        await new Promise((resolve) => {
          timer = setTimeout(resolve, 40);
        });
        currentText = targetName.slice(0, i);
        setSearchTerm(currentText);
      }

      setIsTyping(false);
      setShowResults(true);
      setSelectedDrugIndex((prev) => (prev + 1) % MOCK_DRUGS.length);
    };

    const interval = setInterval(() => {
      triggerSearchCycle();
    }, 6000);

    // Initial load typing
    setSearchTerm(activeDrug.name);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [selectedDrugIndex]);

  return (
    <Card className="rounded-card border border-border bg-card shadow-lg p-5 max-w-xl mx-auto overflow-hidden">
      <div className="flex items-center justify-between border-b pb-4 mb-4">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Simulated Finder</span>
        </div>
        <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded border border-primary/20">Lagos, Nigeria</span>
      </div>

      <div className="relative mb-5">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
        <div className="w-full h-11 pl-10 pr-4 rounded-md border border-border bg-surface flex items-center text-sm font-medium text-ink">
          {searchTerm}
          {isTyping && <span className="w-1.5 h-4 bg-primary ml-0.5 animate-pulse" />}
        </div>
      </div>

      <div className="space-y-3 min-h-[260px]">
        {showResults ? (
          activeDrug.results.map((pharmacy, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-card border border-border hover:border-primary/20 bg-card hover:bg-surface/30 transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-ink text-sm">{pharmacy.name}</span>
                  {pharmacy.verified && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-success bg-success/10 px-1.5 py-0.2 rounded-full">
                      <ShieldCheck className="h-2.5 w-2.5" />
                      PCN Checked
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  <span>{pharmacy.distance}</span>
                  <span>•</span>
                  <span>{activeDrug.dosage}</span>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-2 sm:pt-0">
                <div className="text-left sm:text-right">
                  <div className="text-xs text-muted-foreground font-medium">Est. Price</div>
                  <div className="text-base font-bold text-primary tabular-nums font-mono">{pharmacy.price}</div>
                </div>
                <div className="flex flex-col items-end">
                  {pharmacy.stock === 'in-stock' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-success/10 text-success border border-success/20">
                      <CheckCircle2 className="h-3 w-3" />
                      In Stock ({pharmacy.quantity})
                    </span>
                  )}
                  {pharmacy.stock === 'low-stock' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-warning/10 text-warning border border-warning/20">
                      <AlertTriangle className="h-3 w-3" />
                      Low Stock ({pharmacy.quantity})
                    </span>
                  )}
                  {pharmacy.stock === 'out-of-stock' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-danger/10 text-danger border border-danger/20">
                      Out of Stock
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="h-[260px] flex flex-col justify-center items-center text-center text-muted-foreground">
            <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin mb-3" />
            <span className="text-xs font-semibold uppercase tracking-wider">Searching StocMed Network...</span>
          </div>
        )}
      </div>

      <div className="mt-5 pt-4 border-t text-center">
        <p className="text-xs text-muted-foreground">
          Mock data representing live network status. Click below to start your search.
        </p>
      </div>
    </Card>
  );
}
