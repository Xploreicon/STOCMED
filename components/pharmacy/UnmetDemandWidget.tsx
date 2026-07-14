'use client';

import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Loader2, TrendingUp, AlertTriangle, Plus } from 'lucide-react';
import Link from 'next/link';

export default function UnmetDemandWidget() {
  const { data: unmetDemand, isLoading, error } = useQuery({
    queryKey: ['pharmacy-unmet-demand'],
    queryFn: async () => {
      const res = await fetch('/api/pharmacy/analytics/unmet-demand');
      if (!res.ok) {
        throw new Error('Failed to fetch unmet demand analytics');
      }
      return res.json();
    },
    refetchInterval: 60000, // Refresh every minute to stay fresh
  });

  if (isLoading) {
    return (
      <Card className="rounded-card p-6 border-border shadow-sm flex flex-col justify-center items-center min-h-[300px] bg-card">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
        <span className="text-sm text-muted-foreground font-medium">Analyzing regional search logs...</span>
      </Card>
    );
  }

  if (error || !unmetDemand) {
    return (
      <Card className="rounded-card p-6 border-border shadow-sm bg-danger/5 min-h-[300px] flex flex-col justify-center items-center text-center">
        <AlertTriangle className="w-8 h-8 text-danger mb-2" />
        <span className="text-sm font-semibold text-danger">Failed to load analytics</span>
        <span className="text-xs text-danger/80 mt-1">Please try reloading the dashboard page.</span>
      </Card>
    );
  }

  return (
    <Card className="rounded-card border-border shadow-sm bg-card overflow-hidden">
      <div className="p-5 border-b border-border flex items-center justify-between bg-surface">
        <div>
          <h3 className="font-bold text-ink flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary animate-pulse" />
            Unmet Demand Near You
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Top local patient searches in the last 7 days you are missing or out of stock
          </p>
        </div>
        <span className="text-[10px] font-bold uppercase bg-primary/10 text-primary px-2.5 py-1 rounded-full tracking-wider border border-primary/20">
          Live Demand Data
        </span>
      </div>

      <div className="divide-y divide-border bg-card">
        {unmetDemand.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground/70 text-sm">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CheckCircle2 className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
            </span>
            <span>Your inventory perfectly covers all local searches in your radius.</span>
          </div>
        ) : (
          unmetDemand.map((item: any) => {
            const displayName = item.brand_name ? `${item.brand_name} (${item.generic_name})` : item.generic_name;
            const addQuery = `add_product_id=${item.id}&name=${encodeURIComponent(displayName)}&strength=${encodeURIComponent(item.strength)}&dosage_form=${encodeURIComponent(item.dosage_form)}&category=${encodeURIComponent(item.category)}`;

            return (
              <div key={item.id} className="p-4 flex items-center justify-between hover:bg-surface/50 transition-colors">
                <div className="space-y-1">
                  <div className="font-semibold text-ink text-sm line-clamp-1">{displayName}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground font-medium">{item.strength} • {item.dosage_form}</span>
                    <span className="text-muted-foreground/30">•</span>
                    <span className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-[10px] font-bold border border-primary/20">
                      {item.search_volume} search{item.search_volume > 1 ? 'es' : ''}
                    </span>
                    <span className="text-muted-foreground/30">•</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                      item.reason === 'Out of Stock' 
                        ? 'text-danger bg-danger/10 border-danger/20' 
                        : 'text-warning bg-warning/10 border-warning/20'
                    }`}>
                      {item.reason}
                    </span>
                  </div>
                </div>

                <Link href={`/pharmacy/inventory?${addQuery}`} passHref legacyBehavior>
                  <Button size="sm" className="h-8 text-xs shadow bg-primary hover:bg-primary/90 text-white font-semibold">
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Stock this
                  </Button>
                </Link>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
