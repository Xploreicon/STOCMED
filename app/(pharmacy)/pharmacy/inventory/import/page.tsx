'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Upload,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  HelpCircle,
  Loader2,
  Sparkles,
  Check,
  AlertTriangle
} from 'lucide-react';
import Link from 'next/link';
import {
  autoMapImportHeaders,
  isSafeAutoMatch,
  matchConflictLabels,
  parseImportDate,
} from '@/lib/inventory-import';

type Step = 'upload' | 'mapping' | 'matching' | 'progress' | 'summary';
type ImportSource = 'stocmed' | 'quickbooks';

const CANONICAL_FIELDS = [
  { key: 'name', label: 'Item / Generic Name', required: true, synonyms: ['name', 'generic name', 'drug name', 'medication', 'product'] },
  { key: 'item_type', label: 'Type', required: false, synonyms: ['type', 'department', 'item type', 'product type'] },
  { key: 'tracks_expiry', label: 'Tracks Expiry', required: false, synonyms: ['tracks expiry', 'expiry tracked', 'perishable'] },
  { key: 'brand_name', label: 'Brand Name', required: false, synonyms: ['brand', 'brand name', 'trade name'] },
  { key: 'strength', label: 'Strength', required: false, synonyms: ['strength', 'dosage strength', 'mg', 'g', 'ml'] },
  { key: 'dosage_form', label: 'Dosage Form', required: false, synonyms: ['form', 'dosage form'] },
  { key: 'category', label: 'Category', required: false, synonyms: ['category', 'class', 'group'] },
  { key: 'pack_size', label: 'Pack Size', required: false, synonyms: ['pack', 'pack size', 'packaging'] },
  { key: 'sku', label: 'SKU / Barcode', required: false, synonyms: ['sku', 'barcode', 'product sku'] },
  { key: 'unit_cost', label: 'Unit Cost (₦)', required: false, synonyms: ['cost', 'unit cost', 'purchase cost'] },
  { key: 'price', label: 'Selling Price (₦)', required: true, synonyms: ['price', 'selling price', 'rate', 'unit price'] },
  { key: 'quantity', label: 'Opening Qty', required: true, synonyms: ['quantity', 'qty', 'stock', 'opening qty', 'count'] },
  { key: 'batch_number', label: 'Batch Number', required: false, synonyms: ['batch', 'batch no', 'batch number', 'lot'] },
  { key: 'expiry_date', label: 'Expiry Date', required: false, synonyms: ['expiry', 'exp', 'expiry date', 'exp date'] },
];

function previewValidation(row: any, source: ImportSource) {
  const errors: string[] = []
  const warnings: string[] = []
  const isMedicine = source === 'quickbooks' || row.mapped.item_type === 'medicine'
  const tracksExpiry = isMedicine || row.mapped.tracks_expiry === true
  if (!row.mapped.generic_name) errors.push('Item name is required')
  if (!row.mapped.price || Number(row.mapped.price) <= 0) errors.push('Price must be greater than ₦0')
  if (!Number.isInteger(Number(row.mapped.quantity)) || Number(row.mapped.quantity) < 0) {
    errors.push('Stock quantity must be a non-negative whole number')
  }
  if (isMedicine && !row.selected_product_id) errors.push('Select a catalogue match for medicine')
  if (isMedicine && !row.mapped.strength) errors.push('Strength is missing or not mapped')
  if (isMedicine && !row.mapped.dosage_form) errors.push('Dosage form is missing or not mapped')
  if (!isMedicine && row.selected_product_id) errors.push('Store rows cannot use a catalogue product')
  if (tracksExpiry) {
    if (!row.mapped.batch_number) errors.push('Batch number is missing or not mapped')
    if (!row.mapped.expiry_date) {
      errors.push('Expiry date is missing, invalid, or not mapped')
    } else {
      const parsedExpiry = parseImportDate(row.mapped.expiry_date)
      const expiry = parsedExpiry ? new Date(`${parsedExpiry}T23:59:59.999Z`) : null
      if (!expiry || expiry.getTime() <= Date.now()) errors.push(`Expiry date must be in the future (received "${row.mapped.expiry_date}")`)
      else if (expiry.getTime() < Date.now() + 90 * 24 * 60 * 60 * 1000) warnings.push('Expiry date is within 90 days')
    }
  }
  return { errors, warnings }
}

export default function BulkImportWizard() {
  const router = useRouter();

  const [step, setStep] = useState<Step>('upload');
  const [source, setSource] = useState<ImportSource>('stocmed');
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<any[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  
  // Matching and Validation state
  const [matchedRows, setMatchedRows] = useState<any[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [bulkCategory, setBulkCategory] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  
  // Progress state
  const [importProgress, setImportProgress] = useState(0);
  const [importStats, setImportStats] = useState({
    imported: 0,
    skipped: 0,
    errors: 0,
    total: 0,
  });
  const [isImporting, setIsImporting] = useState(false);

  // File Upload Handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setIsParsing(true);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const res = await fetch('/api/pharmacy/inventory/import/parse', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to parse file');
        setFile(null);
        return;
      }

      const { headers, rows } = await res.json();
      setHeaders(headers);
      setRawRows(rows);
      
      // Run smart auto-mapping
      const initialMapping = autoMapImportHeaders(headers, CANONICAL_FIELDS);
      setMapping(initialMapping);
      setStep('mapping');
    } catch (err) {
      console.error(err);
      alert('Error parsing uploaded file.');
      setFile(null);
    } finally {
      setIsParsing(false);
    }
  };

  // Run matching logic
  const handleMappingSubmit = async () => {
    // Validate that required fields are mapped
    const quickBooksRequired = new Set(['name', 'price', 'quantity']);
    const standardRequired = new Set(['name', 'price', 'quantity']);
    const missingRequired = CANONICAL_FIELDS.filter(f =>
      (source === 'quickbooks' ? quickBooksRequired.has(f.key) : standardRequired.has(f.key)) && !mapping[f.key]
    );
    if (missingRequired.length > 0) {
      alert(`Please map all required fields: ${missingRequired.map(f => f.label).join(', ')}`);
      return;
    }

    setIsValidating(true);
    setStep('matching');

    try {
      const res = await fetch('/api/pharmacy/inventory/import/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rawRows, mapping }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Matching failed');
        setStep('mapping');
        return;
      }

      const { matchedRows: results } = await res.json();
      // High-confidence catalogue matches are medicines; everything else is
      // tenant-owned Store stock unless the spreadsheet supplied a type.
      const initializedResults = results.map((row: any) => {
        const bestMatch = row.matches && row.matches[0];
        const itemType = source === 'quickbooks' ? 'medicine' : row.mapped.item_type;
        const selectedId = itemType === 'medicine' && isSafeAutoMatch(bestMatch) ? bestMatch.id : '';
        const initialized = {
          ...row,
          mapped: { ...row.mapped, item_type: itemType, tracks_expiry: itemType === 'medicine' || row.mapped.tracks_expiry },
          selected_product_id: selectedId,
        };
        return { ...initialized, validation: previewValidation(initialized, source) };
      });

      setMatchedRows(initializedResults);
      setSelectedRows(new Set());
    } catch (err) {
      console.error(err);
      alert('Error during matching stage.');
      setStep('mapping');
    } finally {
      setIsValidating(false);
    }
  };

  const updateDepartment = (indexes: number[], itemType: 'medicine' | 'store') => {
    setMatchedRows((rows) => rows.map((row, index) => {
      if (!indexes.includes(index)) return row
      const selectedProductId = itemType === 'medicine'
        ? row.selected_product_id || (isSafeAutoMatch(row.matches?.[0]) ? row.matches[0].id : '')
        : ''
      const updated = {
        ...row,
        selected_product_id: selectedProductId,
        mapped: {
          ...row.mapped,
          item_type: itemType,
          tracks_expiry: itemType === 'medicine' ? true : row.mapped.tracks_expiry,
        },
      }
      return { ...updated, validation: previewValidation(updated, source) }
    }))
  }

  // Commit Import
  const handleCommitImport = async () => {
    // Check if any row has validation errors
    const errorCount = matchedRows.filter(r => r.validation.errors.length > 0).length;
    if (errorCount > 0) {
      alert(`Resolve the validation errors in ${errorCount} row(s) before importing. No rows have been committed.`);
      return;
    }

    setIsImporting(true);
    setImportProgress(0);

    try {
      const payloadRows = matchedRows.map(r => ({
        mapped: r.mapped,
        selected_product_id: r.selected_product_id
      }));
      const requestBody = { matchedRows: payloadRows, source: source === 'quickbooks' ? 'quickbooks' : undefined };
      const preflightRes = await fetch('/api/pharmacy/inventory/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestBody, validate_only: true }),
      });
      const preflight = await preflightRes.json();

      if (!preflightRes.ok) {
        if (Array.isArray(preflight.rowErrors)) {
          const errorsByRow = new Map<number, string[]>(
            preflight.rowErrors.map((entry: any) => [entry.row - 1, entry.errors])
          );
          setMatchedRows(rows => rows.map((row, index) => ({
            ...row,
            validation: {
              ...row.validation,
              errors: errorsByRow.get(index) || [],
            },
          })));
        }
        throw new Error(preflight.error || 'Import preflight failed');
      }

      setStep('progress');
      const res = await fetch('/api/pharmacy/inventory/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const result = await res.json();
      if (!res.ok) {
        const rowDetails = Array.isArray(result.rowErrors)
          ? result.rowErrors.map((entry: any) => `Row ${entry.row}: ${entry.errors.join(', ')}`).join('\n')
          : '';
        throw new Error([result.error || 'Import failed', rowDetails].filter(Boolean).join('\n'));
      }

      setImportProgress(100);
      setImportStats({ imported: result.imported, skipped: 0, errors: 0, total: result.total });
      setIsImporting(false);
      setStep('summary');
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error executing import transaction');
      setIsImporting(false);
      setStep('matching');
    }
  };

  return (
    <div className="min-h-screen bg-surface py-10 px-4 md:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Breadcrumb / Back Navigation */}
        <div className="flex items-center justify-between">
          <Link href="/pharmacy/inventory" className="inline-flex items-center text-sm font-medium text-ink-muted hover:text-ink transition-colors">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Inventory
          </Link>
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-light">
            Step {step === 'upload' ? '1/4' : step === 'mapping' ? '2/4' : step === 'matching' ? '3/4' : '4/4'}
          </div>
        </div>

        {/* STEP 1: Upload */}
        {step === 'upload' && (
          <Card className="p-8 space-y-8 border-border shadow-xl bg-white rounded-xl">
            <div className="text-center space-y-2">
              <div className="h-14 w-14 bg-primary/5 text-primary rounded-full flex items-center justify-center mx-auto shadow-inner">
                <FileSpreadsheet className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-display font-bold text-ink">Bulk Inventory Onboarding</h1>
              <p className="text-ink-muted max-w-md mx-auto text-sm">
                Upload your pharmacy&apos;s product list. We support CSV and Excel (.xlsx) files.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-1 rounded-input border border-border bg-surface p-1">
              <Button variant={source === 'stocmed' ? 'default' : 'ghost'} onClick={() => setSource('stocmed')}>StocMed template</Button>
              <Button variant={source === 'quickbooks' ? 'default' : 'ghost'} onClick={() => setSource('quickbooks')}>QuickBooks export</Button>
            </div>

            {source === 'quickbooks' && <div className="border-l-4 border-primary bg-primary/5 p-4 text-sm text-ink"><strong>Switch from QuickBooks</strong><p className="mt-1 text-ink-muted">Product/Service Name, SKU, Quantity on Hand, Cost, and Price are mapped automatically. QuickBooks did not store batch or expiry data, so matched rows enter an expiry-capture queue before becoming sellable stock.</p></div>}

            <div className="border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-12 transition-all text-center bg-surface/50">
              <input
                type="file"
                accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                id="file-upload"
                className="hidden"
                onChange={handleFileUpload}
                disabled={isParsing}
              />
              <label htmlFor="file-upload" className="cursor-pointer block space-y-4">
                {isParsing ? (
                  <div className="flex flex-col items-center justify-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <span className="text-sm font-semibold text-ink-muted">Uploading and parsing file...</span>
                  </div>
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-ink-light mx-auto" />
                    <div>
                      <span className="text-primary hover:text-primary/80 font-semibold underline">Click to upload</span>
                      <span className="text-ink-muted"> or drag and drop</span>
                    </div>
                    <p className="text-xs text-ink-light">CSV or XLSX (Max. 5MB)</p>
                  </>
                )}
              </label>
            </div>

            <div className="flex items-center justify-between border-t border-border pt-6">
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <HelpCircle className="w-4 h-4 text-ink-light" />
                <span>Need a template to format your list?</span>
              </div>
              <a
                href="/templates/inventory_import_template.csv"
                download
                className="inline-flex items-center px-4 py-2 border border-border rounded-md text-sm font-semibold text-ink bg-white hover:bg-surface shadow-sm"
              >
                Download Template CSV
              </a>
            </div>
          </Card>
        )}

        {/* STEP 2: Mapping */}
        {step === 'mapping' && (
          <Card className="p-8 space-y-6 border-border shadow-xl bg-white rounded-xl">
            <div>
              <h2 className="text-xl font-display font-bold text-ink">Map Columns</h2>
              <p className="text-ink-muted text-sm mt-1">
                Map the headers of your spreadsheet to StocMed&apos;s product fields. We&apos;ve auto-detected matches.
              </p>
            </div>

            <div className="divide-y divide-border border border-border rounded-lg overflow-hidden bg-surface/50 shadow-inner">
              {CANONICAL_FIELDS.map((field) => (
                <div key={field.key} className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 items-center bg-white hover:bg-surface/30">
                  <div>
                    <span className="text-sm font-semibold text-ink">{field.label}</span>
                    {(source === 'quickbooks' ? ['name', 'price', 'quantity'].includes(field.key) : field.required) && <span className="text-danger ml-1 font-bold">*</span>}
                    <p className="text-xs text-ink-light mt-0.5">
                      {(source === 'quickbooks' ? ['name', 'price', 'quantity'].includes(field.key) : field.required) ? 'Required field.' : 'Optional.'}
                    </p>
                  </div>
                  <div>
                    <select
                      value={mapping[field.key] || ''}
                      onChange={(e) => setMapping(prev => ({ ...prev, [field.key]: e.target.value }))}
                      className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm bg-white"
                    >
                      <option value="">-- Do Not Import --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button variant="ghost" onClick={() => setStep('upload')}>
                Cancel
              </Button>
              <Button onClick={handleMappingSubmit} className="shadow-lg">
                Match Catalogue & Preview
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </Card>
        )}

        {/* STEP 3: Matching & Preview */}
        {step === 'matching' && (
          <Card className="p-8 space-y-6 border-border shadow-xl bg-white rounded-xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-display font-bold text-ink">Review Departments & Matches</h2>
                <p className="text-ink-muted text-sm mt-1">
                  Strong catalogue matches route to Medicines. Unmatched rows stay private in Store.
                </p>
              </div>
              <Button
                onClick={handleCommitImport}
                disabled={isValidating || matchedRows.some(row => row.validation.errors.length > 0) || (source === 'quickbooks' && matchedRows.some(row => !row.selected_product_id))}
                className="shadow-lg"
              >
                Import {matchedRows.length} Items
              </Button>
            </div>

            {isValidating ? (
              <div className="py-24 text-center space-y-4">
                <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
                <p className="text-ink-muted font-medium">Running catalogue matching algorithms...</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateDepartment(
                      matchedRows.map((row, index) => !isSafeAutoMatch(row.matches?.[0]) ? index : -1).filter((index) => index >= 0),
                      'store'
                    )}
                  >
                    Set all unmatched to Store
                  </Button>
                  <select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} className="h-9 rounded-md border border-border bg-white px-3 text-sm">
                    <option value="">Choose category</option>
                    {Array.from(new Set(matchedRows.map((row) => row.mapped.category).filter(Boolean))).map((category: any) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!bulkCategory}
                    onClick={() => updateDepartment(
                      matchedRows.map((row, index) => row.mapped.category === bulkCategory ? index : -1).filter((index) => index >= 0),
                      'store'
                    )}
                  >
                    Set category to Store
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selectedRows.size === 0}
                    onClick={() => updateDepartment(Array.from(selectedRows), 'medicine')}
                  >
                    Set selected to Medicine
                  </Button>
                </div>
                <div className="overflow-x-auto border border-border rounded-lg bg-white shadow-inner">
                  <table className="w-full text-left text-sm divide-y divide-border">
                    <thead className="bg-surface text-ink-muted font-semibold text-xs uppercase">
                      <tr>
                        <th className="p-3">
                          <input
                            type="checkbox"
                            aria-label="Select all rows"
                            checked={matchedRows.length > 0 && selectedRows.size === matchedRows.length}
                            onChange={(e) => setSelectedRows(e.target.checked ? new Set(matchedRows.map((_, index) => index)) : new Set())}
                            className="h-4 w-4 accent-primary"
                          />
                        </th>
                        <th className="p-3">Item (Spreadsheet)</th>
                        <th className="p-3">Strength & Form</th>
                        <th className="p-3">Price & Stock</th>
                        <th className="p-3">Department</th>
                        <th className="p-3">Catalogue Match</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {matchedRows.map((row, index) => {
                        const hasErrors = row.validation.errors.length > 0;
                        const hasWarnings = row.validation.warnings.length > 0;

                        return (
                          <tr key={index} className={`hover:bg-surface/50 transition-colors ${hasErrors ? 'bg-danger/5' : ''}`}>
                            <td className="p-3">
                              <input
                                type="checkbox"
                                aria-label={`Select row ${index + 1}`}
                                checked={selectedRows.has(index)}
                                onChange={(e) => setSelectedRows((current) => {
                                  const next = new Set(current)
                                  if (e.target.checked) next.add(index)
                                  else next.delete(index)
                                  return next
                                })}
                                className="h-4 w-4 accent-primary"
                              />
                            </td>
                            <td className="p-3">
                              <div className="font-semibold text-ink">{row.mapped.generic_name}</div>
                              {row.mapped.brand_name && (
                                <div className="text-xs text-ink-light">Brand: {row.mapped.brand_name}</div>
                              )}
                            </td>
                            <td className="p-3">
                              <div>{row.mapped.strength || 'N/A'}</div>
                              <div className="text-xs text-ink-muted capitalize">{row.mapped.dosage_form}</div>
                            </td>
                            <td className="p-3">
                              <div className="font-semibold">₦{row.mapped.price?.toLocaleString()}</div>
                              <div className="text-xs text-ink-muted">{row.mapped.quantity} in stock</div>
                              {(row.mapped.item_type === 'medicine' || row.mapped.tracks_expiry) && (
                                <div className="mt-1 text-[11px] text-ink-light">
                                  Batch: {row.mapped.batch_number || 'not mapped'} · Expiry: {row.mapped.expiry_date || 'not mapped'}
                                </div>
                              )}
                            </td>
                            <td className="p-3">
                              <select
                                value={row.mapped.item_type}
                                onChange={(e) => updateDepartment([index], e.target.value as 'medicine' | 'store')}
                                className="w-[120px] rounded-md border border-border bg-white px-2 py-1.5 text-xs font-semibold"
                              >
                                <option value="medicine">Medicine</option>
                                <option value="store">Store</option>
                              </select>
                              <div className="mt-1 text-[11px] text-ink-light">
                                Best match: {Math.round(Number(row.matches?.[0]?.confidence ?? 0) * 100)}%
                              </div>
                              {matchConflictLabels(row.matches?.[0]).map((reason) => (
                                <span key={reason} className="mr-1 mt-1 inline-flex rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold text-danger">
                                  {reason}
                                </span>
                              ))}
                              {row.mapped.item_type === 'store' && (
                                <label className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-muted">
                                  <input
                                    type="checkbox"
                                    checked={row.mapped.tracks_expiry === true}
                                    onChange={(e) => {
                                      setMatchedRows((rows) => rows.map((candidate, candidateIndex) => {
                                        if (candidateIndex !== index) return candidate
                                        const updated = { ...candidate, mapped: { ...candidate.mapped, tracks_expiry: e.target.checked } }
                                        return { ...updated, validation: previewValidation(updated, source) }
                                      }))
                                    }}
                                    className="h-3.5 w-3.5 accent-primary"
                                  />
                                  Tracks expiry
                                </label>
                              )}
                            </td>
                            <td className="p-3">
                              <select
                                value={row.selected_product_id || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setMatchedRows(prev => prev.map((r, i) => {
                                    if (i !== index) return r
                                    const updated = { ...r, selected_product_id: val }
                                    return { ...updated, validation: previewValidation(updated, source) }
                                  }));
                                }}
                                disabled={row.mapped.item_type === 'store'}
                                className="w-[220px] px-2 py-1.5 border border-border rounded-md focus:ring-1 focus:ring-primary text-xs bg-white"
                              >
                                <option value="">{row.mapped.item_type === 'store' ? 'Not added to catalogue' : 'Select a catalogue match'}</option>
                                {row.matches && row.matches.map((m: any) => (
                                  <option key={m.id} value={m.id} disabled={m.strength_match === false || m.form_match === false}>
                                    {m.brand_name ? `${m.brand_name} (${m.generic_name})` : m.generic_name} ({m.strength}, {m.dosage_form}) - {Math.round(m.confidence * 100)}%{matchConflictLabels(m).length ? ` - ${matchConflictLabels(m).join(', ')}` : ''}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-3 text-center">
                              {hasErrors ? (
                                <div className="min-w-[220px] rounded-md border border-danger/20 bg-danger/5 p-2 text-left text-xs text-danger">
                                  <div className="mb-1 flex items-center gap-1 font-semibold">
                                    <AlertCircle className="h-3.5 w-3.5" />
                                    Fix this row
                                  </div>
                                  <ul className="space-y-0.5">
                                    {row.validation.errors.map((message: string) => <li key={message}>• {message}</li>)}
                                  </ul>
                                </div>
                              ) : hasWarnings ? (
                                <div className="inline-flex items-center gap-1 text-warning bg-warning/10 px-2 py-0.5 rounded text-xs font-semibold" title={row.validation.warnings.join(', ')}>
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  Warning
                                </div>
                              ) : (
                                <div className="inline-flex items-center gap-1 text-success bg-success/10 px-2 py-0.5 rounded text-xs font-semibold">
                                  <Check className="w-3.5 h-3.5" />
                                  Valid
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* STEP 4: Progress */}
        {step === 'progress' && (
          <Card className="p-8 space-y-8 border-border shadow-xl bg-white rounded-xl text-center">
            <div className="space-y-3">
              <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
              <h2 className="text-xl font-display font-bold text-ink">Importing Inventory...</h2>
              <p className="text-ink-muted text-sm">Do not close this tab. We are committing batch transactions to the ledger.</p>
            </div>

            <div className="space-y-2">
              <div className="h-3 w-full bg-surface rounded-full overflow-hidden border">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs font-semibold text-ink-muted">
                <span>Progress: {importProgress}%</span>
                <span>{importStats.imported + importStats.errors} of {importStats.total} rows</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 border-t border-border pt-6">
              <div className="p-4 bg-surface rounded-lg">
                <div className="text-xl font-bold text-success">{importStats.imported}</div>
                <div className="text-xs text-ink-light mt-1 uppercase font-semibold">Imported</div>
              </div>
              <div className="p-4 bg-surface rounded-lg">
                <div className="text-xl font-bold text-ink-muted">{importStats.skipped}</div>
                <div className="text-xs text-ink-light mt-1 uppercase font-semibold">Skipped</div>
              </div>
              <div className="p-4 bg-surface rounded-lg">
                <div className="text-xl font-bold text-danger">{importStats.errors}</div>
                <div className="text-xs text-ink-light mt-1 uppercase font-semibold">Errors</div>
              </div>
            </div>
          </Card>
        )}

        {/* STEP 5: Summary */}
        {step === 'summary' && (
          <Card className="p-8 space-y-8 border-border shadow-xl bg-white rounded-xl text-center">
            <div className="space-y-3">
              <div className="h-16 w-16 bg-success/10 text-success rounded-full flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-display font-bold text-ink">Import Complete!</h2>
              <p className="text-ink-muted text-sm max-w-sm mx-auto">{source === 'quickbooks' ? 'Your QuickBooks products are matched and staged. Capture the physical batch and expiry printed on each carton to move them into sellable stock.' : 'Your inventory spreadsheet has been successfully integrated into the StocMed database spine.'}</p>
            </div>

            <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
              <div className="p-4 bg-surface border rounded-lg">
                <div className="text-2xl font-bold text-success">{importStats.imported}</div>
                <div className="text-xs text-ink-light mt-1">Successfully Imported</div>
              </div>
              <div className="p-4 bg-surface border rounded-lg">
                <div className="text-2xl font-bold text-danger">{importStats.errors}</div>
                <div className="text-xs text-ink-light mt-1">Errors Encountered</div>
              </div>
            </div>

            <div className="flex justify-center gap-3 pt-6 border-t border-border max-w-md mx-auto">
              <Button variant="outline" onClick={() => setStep('upload')}>
                Import Another File
              </Button>
              <Button onClick={() => router.push(source === 'quickbooks' ? '/pharmacy/inventory/expiry-capture' : '/pharmacy/inventory')} className="shadow-lg">
                {source === 'quickbooks' ? 'Capture batch & expiry' : 'Go to Inventory Table'}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
