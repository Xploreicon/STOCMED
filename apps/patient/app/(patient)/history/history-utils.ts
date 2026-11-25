export type RecordedSearchStatus = 'found' | 'none' | 'unknown';

/** Search counts describe matches at search time, never the quantity left on a shelf. */
export function recordedSearchStatus(count: number | null | undefined): RecordedSearchStatus {
  if (count == null || !Number.isFinite(count) || count < 0) return 'unknown';
  return count > 0 ? 'found' : 'none';
}

export function recordedSearchSummary(count: number | null | undefined, location?: string | null) {
  const status = recordedSearchStatus(count);
  const place = location?.trim() ? ` near ${location.trim()}` : '';
  if (status === 'unknown') return `Availability was not recorded${place}`;
  if (status === 'none') return `No pharmacy matches found${place} at the time`;
  return `${count} ${count === 1 ? 'pharmacy' : 'pharmacies'} found${place} at the time`;
}

export function repeatSearchHref(query: string, location?: string | null) {
  const params = new URLSearchParams({ q: query });
  if (location?.trim()) params.set('location', location.trim());
  return `/chat?${params.toString()}`;
}
