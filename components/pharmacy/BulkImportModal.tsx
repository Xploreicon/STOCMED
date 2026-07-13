'use client';

import { Button } from '@/components/ui/button'

import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { X } from 'lucide-react';

interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'upload' | 'map' | 'match' | 'preview';

const REQUIRED_FIELDS = [
  { key: 'generic_name', label: 'Generic name', required: true },
  { key: 'brand_name', label: 'Brand name', required: false },
  { key: 'strength', label: 'Strength', required: true },
  { key: 'dosage_form', label: 'Dosage form', required: false },
  { key: 'category', label: 'Category', required: false },
  { key: 'price', label: 'Price (₦)', required: true },
  { key: 'quantity', label: 'Opening stock', required: false },
  { key: 'batch_number', label: 'Batch number', required: false },
  { key: 'expiry_date', label: 'Expiry date (YYYY-MM-DD)', required: false },
] as const;

type FieldKey = (typeof REQUIRED_FIELDS)[number]['key'];

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  const parseLine = (line: string) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const [headerLine, ...rest] = lines;
  return { headers: parseLine(headerLine || ''), rows: rest.map(parseLine) };
}

function guessColumn(headers: string[], field: FieldKey): string {
  const normalized = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const target = field.replace(/_/g, '');
  const idx = normalized.findIndex((h) => h.includes(target) || target.includes(h));
  return idx >= 0 ? headers[idx] : '';
}

function downloadTemplate() {
  const header = REQUIRED_FIELDS.map((f) => f.key).join(',');
  const example =
    'Amoxicillin,Amoxil,500mg,capsule,Antibiotics,1200,50,B24178,2027-03-01';
  const blob = new Blob([`${header}\n${example}\n`], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'stocmed-inventory-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

interface MatchedRow {
  raw: Record<FieldKey, string>;
  product_id?: string;
  matchLabel: string;
}

export default function BulkImportModal({ isOpen, onClose, onSuccess }: BulkImportModalProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [columnMap, setColumnMap] = useState<Record<FieldKey, string>>(
    Object.fromEntries(REQUIRED_FIELDS.map((f) => [f.key, ''])) as Record<FieldKey, string>
  );
  const [isMatching, setIsMatching] = useState(false);
  const [matchedRows, setMatchedRows] = useState<MatchedRow[]>([]);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitSummary, setCommitSummary] = useState<{ succeeded: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = { upload: 0, map: 1, match: 2, preview: 3 }[step];
  const stepLabels = ['Upload CSV/Excel', 'Map columns', 'Match to catalogue', 'Preview & commit'];

  const resetAndClose = () => {
    setStep('upload');
    setFileName('');
    setHeaders([]);
    setCsvRows([]);
    setMatchedRows([]);
    setCommitSummary(null);
    setError(null);
    onClose();
  };

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a CSV file (export Excel sheets as CSV first).');
      return;
    }
    setError(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const { headers: parsedHeaders, rows } = parseCsv(String(reader.result));
      setHeaders(parsedHeaders);
      setCsvRows(rows);
      const guessed = Object.fromEntries(
        REQUIRED_FIELDS.map((f) => [f.key, guessColumn(parsedHeaders, f.key)])
      ) as Record<FieldKey, string>;
      setColumnMap(guessed);
      setStep('map');
    };
    reader.readAsText(file);
  };

  const rowObjects = useMemo(() => {
    return csvRows.map((cells) => {
      const obj = {} as Record<FieldKey, string>;
      for (const f of REQUIRED_FIELDS) {
        const colIdx = headers.indexOf(columnMap[f.key]);
        obj[f.key] = colIdx >= 0 ? cells[colIdx] ?? '' : '';
      }
      return obj;
    });
  }, [csvRows, headers, columnMap]);

  const handleConfirmMapping = () => {
    const missing = REQUIRED_FIELDS.filter((f) => f.required && !columnMap[f.key]);
    if (missing.length > 0) {
      setError(`Map a column for: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    setError(null);
    setStep('match');
    runMatching();
  };

  const runMatching = async () => {
    setIsMatching(true);
    try {
      const uniqueGenericNames = Array.from(new Set(rowObjects.map((r) => r.generic_name.toLowerCase()).filter(Boolean)));
      const catalogueByName = new Map<string, any[]>();

      await Promise.all(
        uniqueGenericNames.map(async (name) => {
          const response = await fetch(`/api/pharmacy/catalogue?q=${encodeURIComponent(name)}`);
          if (response.ok) {
            const data = await response.json();
            catalogueByName.set(name, data.products ?? []);
          }
        })
      );

      const matched: MatchedRow[] = rowObjects.map((row) => {
        const candidates = catalogueByName.get(row.generic_name.toLowerCase()) ?? [];
        const exact = candidates.find(
          (c) =>
            c.generic_name.toLowerCase() === row.generic_name.toLowerCase() &&
            c.strength.toLowerCase() === row.strength.toLowerCase()
        );
        return {
          raw: row,
          product_id: exact?.id,
          matchLabel: exact ? `Matched · ${exact.generic_name} ${exact.strength}` : 'New product',
        };
      });

      setMatchedRows(matched);
      setStep('preview');
    } finally {
      setIsMatching(false);
    }
  };

  const handleCommit = async () => {
    setIsCommitting(true);
    setError(null);
    try {
      const response = await fetch('/api/pharmacy/drugs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: matchedRows.map((m) => ({
            product_id: m.product_id,
            new_product: m.product_id
              ? undefined
              : {
                  generic_name: m.raw.generic_name,
                  brand_name: m.raw.brand_name || undefined,
                  strength: m.raw.strength,
                  dosage_form: m.raw.dosage_form || undefined,
                  category: m.raw.category || undefined,
                },
            price: m.raw.price,
            quantity: m.raw.quantity,
            batch_number: m.raw.batch_number || undefined,
            expiry_date: m.raw.expiry_date || undefined,
          })),
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Import failed');
      }
      const data = await response.json();
      setCommitSummary(data.summary);
      queryClient.invalidateQueries({ queryKey: ['pharmacy-drugs'], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stats'], refetchType: 'active' });
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setIsCommitting(false);
    }
  };

  const newProductCount = matchedRows.filter((m) => !m.product_id).length;

  return (
    <Dialog open={isOpen} onOpenChange={resetAndClose}>
      <DialogContent className="max-h-[85vh] max-w-[480px] overflow-y-auto rounded-feature p-7">
        <div className="mb-5 flex items-center justify-between">
          <DialogTitle className="text-xl font-medium text-ink">Bulk stock update</DialogTitle>
          <Button
            onClick={resetAndClose}
            className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-tint text-secondary"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="mb-6 flex items-center gap-1">
          {stepLabels.map((label, i) => (
            <div key={label} className="flex flex-1 flex-col items-center gap-1.5">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium"
                style={{
                  background: i === stepIndex ? 'var(--primary)' : 'var(--surface)',
                  color: i === stepIndex ? 'var(--white)' : 'var(--ink-muted)',
                }}
              >
                {i + 1}
              </div>
              <span className="text-center text-[11px] text-secondary">{label}</span>
            </div>
          ))}
        </div>

        {step === 'upload' && (
          <>
            <div className="flex flex-col items-center gap-2 rounded-card border-2 border-dashed border-hairline px-6 py-10 text-center">
              <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-card bg-brand-tint text-[22px]">
                📥
              </div>
              <h3 className="text-[16px] font-medium text-ink">Upload CSV or Excel file</h3>
              <p className="text-sm leading-relaxed text-secondary">
                Drag and drop your file here, or click to browse. Handles 500+ rows in one go.
              </p>
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 h-11 rounded-control border-[1.5px] border-brand px-5 text-sm font-medium text-brand"
              >
                Choose file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              {fileName && <p className="mt-2 text-xs text-secondary">Selected: {fileName}</p>}
            </div>
            {error && <p className="mt-3 text-xs text-stock-out">{error}</p>}
            <Button
              onClick={downloadTemplate}
              className="mt-4 block w-full text-center text-[13px] font-medium text-brand"
            >
              Download CSV template
            </Button>
          </>
        )}

        {step === 'map' && (
          <>
            <p className="mb-4 text-sm text-secondary">
              Match each field to a column from <strong className="text-ink">{fileName}</strong>.
            </p>
            <div className="flex flex-col gap-3">
              {REQUIRED_FIELDS.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-3">
                  <label className="text-sm text-ink">
                    {f.label}
                    {f.required && <span className="text-stock-out"> *</span>}
                  </label>
                  <select
                    className="h-10 w-48 rounded-control border border-hairline bg-white px-2 text-sm text-ink"
                    value={columnMap[f.key]}
                    onChange={(e) => setColumnMap((m) => ({ ...m, [f.key]: e.target.value }))}
                  >
                    <option value="">Not mapped</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {error && <p className="mt-3 text-xs text-stock-out">{error}</p>}
            <div className="mt-6 flex gap-3">
              <Button
                onClick={() => setStep('upload')}
                className="h-12 flex-1 rounded-control border border-hairline text-[15px] font-medium text-secondary"
              >
                Back
              </Button>
              <Button
                onClick={handleConfirmMapping}
                className="h-12 flex-1 rounded-control bg-brand text-[15px] font-medium text-white"
              >
                Continue
              </Button>
            </div>
          </>
        )}

        {step === 'match' && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-secondary">
              {isMatching ? 'Matching rows to the drug catalogue…' : 'Matching complete.'}
            </p>
          </div>
        )}

        {step === 'preview' && (
          <>
            {!commitSummary ? (
              <>
                <p className="mb-4 text-sm text-secondary">
                  <strong className="text-ink">{matchedRows.length}</strong> rows ready ·{' '}
                  <strong className="text-ink">{matchedRows.length - newProductCount}</strong> matched to your
                  catalogue · <strong className="text-ink">{newProductCount}</strong> will be added as new products.
                </p>
                <div className="max-h-[240px] overflow-y-auto rounded-card border border-hairline">
                  {matchedRows.slice(0, 50).map((m, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2 last:border-b-0"
                    >
                      <span className="truncate text-sm text-ink">
                        {m.raw.generic_name} {m.raw.strength}
                      </span>
                      <span className={`text-xs font-medium ${m.product_id ? 'text-stock-in' : 'text-brand'}`}>
                        {m.matchLabel}
                      </span>
                    </div>
                  ))}
                  {matchedRows.length > 50 && (
                    <p className="px-3 py-2 text-xs text-muted">…and {matchedRows.length - 50} more rows</p>
                  )}
                </div>
                {error && <p className="mt-3 text-xs text-stock-out">{error}</p>}
                <div className="mt-6 flex gap-3">
                  <Button
                    onClick={() => setStep('map')}
                    disabled={isCommitting}
                    className="h-12 flex-1 rounded-control border border-hairline text-[15px] font-medium text-secondary"
                  >
                    Back
                  </Button>
                  <Button
                    onClick={handleCommit}
                    disabled={isCommitting}
                    className="h-12 flex-1 rounded-control bg-brand text-[15px] font-medium text-white disabled:opacity-60"
                  >
                    {isCommitting ? 'Uploading…' : 'Upload & update'}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-ink">
                  Imported <strong>{commitSummary.succeeded}</strong> of{' '}
                  <strong>{commitSummary.succeeded + commitSummary.failed}</strong> rows successfully.
                  {commitSummary.failed > 0 && (
                    <span className="text-stock-out"> {commitSummary.failed} rows failed — check for duplicates.</span>
                  )}
                </p>
                <Button
                  onClick={resetAndClose}
                  className="mt-6 h-12 w-full rounded-control bg-brand text-[15px] font-medium text-white"
                >
                  Done
                </Button>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
