'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Database, ShieldAlert, CheckCircle, Search, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTier, setFilterTier] = useState('all');

  const supabase = createClient();

  const fetchLogs = React.useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase.from('triage_logs').select('*');

      if (filterTier !== 'all') {
        query = query.eq('risk_tier', filterTier);
      }

      const { data, error } = await query.order('created_at', { ascending: false }).limit(100);

      if (error) throw error;
      setLogs(data || []);
    } catch (err: any) {
      console.error('Error fetching triage logs:', err);
      toast.error('Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, [filterTier, supabase]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const filteredLogs = logs.filter((log) => {
    const searchStr = searchTerm.toLowerCase();
    return (
      log.query_hash.toLowerCase().includes(searchStr) ||
      log.intent.toLowerCase().includes(searchStr) ||
      log.risk_tier.toLowerCase().includes(searchStr)
    );
  });

  return (
    <div className="space-y-6 text-left">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4 gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">
            Triage Audit Logs
          </h1>
          <p className="text-sm text-surface0 mt-1">
            Review automated intent classifications and safety gates triggered by patient chats.
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center space-x-2 self-start sm:self-center">
          <span className="text-xs font-semibold text-surface0">Risk Tier:</span>
          <select
            value={filterTier}
            onChange={(e) => setFilterTier(e.target.value)}
            className="text-xs bg-white border border-border rounded-lg p-2 font-medium"
          >
            <option value="all">All Tiers</option>
            <option value="ALLOW">ALLOW</option>
            <option value="GATE">GATE</option>
            <option value="REDIRECT">REDIRECT</option>
            <option value="BLOCK_SOURCING">BLOCK_SOURCING</option>
            <option value="CRISIS">CRISIS</option>
          </select>
        </div>
      </div>

      {/* Search Input */}
      <div className="relative w-full max-w-sm">
        <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-light">
          <Search className="w-4 h-4" />
        </span>
        <input
          type="text"
          placeholder="Search by intent, tier, or hash..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-xs bg-white border border-border rounded-lg focus:outline-none focus:border-blue-500 transition-colors"
        />
      </div>

      {/* Audit Table */}
      <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-20">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
            <span className="text-sm text-surface0">Loading audit trail...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-20">
            <Database className="w-12 h-12 text-border mb-3" />
            <span className="text-sm font-semibold text-ink-muted">No logs found</span>
            <span className="text-xs text-ink-light mt-1">No triage events recorded in this range.</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface border-b border-border text-surface0 uppercase tracking-wider font-semibold">
                  <th className="p-4">Query Hash (Anonymized)</th>
                  <th className="p-4">Intent</th>
                  <th className="p-4">Risk Tier</th>
                  <th className="p-4">Confidence</th>
                  <th className="p-4">Trigger Layers</th>
                  <th className="p-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-surface/50 transition-colors">
                    <td className="p-4 font-mono text-[10px] text-ink-light truncate max-w-[150px]" title={log.query_hash}>
                      {log.query_hash}
                    </td>
                    <td className="p-4 font-semibold text-ink">
                      {log.intent}
                    </td>
                    <td className="p-4">
                      <span
                        className={`font-bold uppercase tracking-wider text-[9px] px-2 py-0.5 rounded-full ${
                          log.risk_tier === 'ALLOW'
                            ? 'bg-green-100 text-green-800'
                            : log.risk_tier === 'GATE'
                            ? 'bg-blue-100 text-blue-800'
                            : log.risk_tier === 'REDIRECT'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {log.risk_tier}
                      </span>
                    </td>
                    <td className="p-4 font-mono font-semibold text-ink-muted">
                      {parseFloat(log.confidence).toFixed(2)}
                    </td>
                    <td className="p-4 flex flex-wrap gap-1">
                      {log.layers_triggered?.map((layer: string, i: number) => (
                        <span
                          key={i}
                          className="bg-surface text-ink-muted px-1.5 py-0.5 rounded text-[10px] font-medium"
                        >
                          {layer}
                        </span>
                      ))}
                    </td>
                    <td className="p-4 text-surface0 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
