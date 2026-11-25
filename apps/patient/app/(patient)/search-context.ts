export function searchAreaLabel(location?: string | null) {
  const area = location?.trim();
  if (!area || ['nearby', 'your current location'].includes(area.toLowerCase())) return null;
  return area;
}

/** A typed area takes precedence over coordinates saved by an earlier search. */
export function medicineSearchParams(
  query: string,
  location?: string | null,
  coordinates?: { latitude: number; longitude: number } | null,
) {
  const params = new URLSearchParams({ q: query });
  const area = searchAreaLabel(location);
  if (area) {
    params.set('location', area);
  } else if (coordinates && Number.isFinite(coordinates.latitude) && Number.isFinite(coordinates.longitude)) {
    params.set('lat', String(coordinates.latitude));
    params.set('lng', String(coordinates.longitude));
  }
  return params;
}
