'use client';

import { useQuery } from '@tanstack/react-query';

interface UnmetDemandCardProps {
  onAdd: (drugName: string) => void;
}

export default function UnmetDemandCard({ onAdd }: UnmetDemandCardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy-unmet-demand'],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy/unmet-demand');
      if (!response.ok) throw new Error('Failed to fetch unmet demand');
      return response.json();
    },
  });

  const demand: Array<{ rank: number; drug: string; searches: number }> = data?.demand ?? [];

  if (!isLoading && demand.length === 0) return null;

  return (
    <div className="mt-8 rounded-card border border-hairline bg-brand-tint p-6">
      <h2 className="text-[16px] font-medium text-ink">
        Patients near you are searching for these — and you don&apos;t stock them
      </h2>
      <p className="mt-1 text-[13px] text-secondary">Stock these to capture nearby demand</p>
      <div className="mt-[18px] flex flex-col gap-2.5">
        {isLoading &&
          [0, 1, 2].map((i) => (
            <div key={i} className="h-[52px] animate-pulse rounded-lg border border-hairline bg-white" />
          ))}
        {!isLoading &&
          demand.map((d) => (
            <div
              key={d.rank}
              className="flex items-center justify-between gap-4 rounded-[10px] border border-hairline bg-white px-4 py-3.5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="w-[22px] shrink-0 text-center text-[15px] font-medium text-brand-deep">
                  {d.rank}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{d.drug}</div>
                  <div className="mt-0.5 text-xs text-muted">{d.searches} searches nearby · last 7 days</div>
                </div>
              </div>
              <button
                onClick={() => onAdd(d.drug)}
                className="h-9 shrink-0 whitespace-nowrap rounded-control bg-brand px-3.5 text-[13px] font-medium text-white"
              >
                Add to inventory
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}
