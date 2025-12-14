import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

const formatHourLabel = (hour: number) => {
  const period = hour >= 12 ? 'pm' : 'am';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}${period}`;
};

export default async function InsightsPage() {
  const supabase = await createClient();

  const { count: medicationsListed = 0 } = await supabase
    .from('drugs')
    .select('id', { count: 'exact', head: true });

  const { data: pharmacyRowsRaw } = await supabase
    .from('pharmacies')
    .select('id, is_active');

  const pharmacyRows =
    (pharmacyRowsRaw ?? []) as Array<{ id: string; is_active: boolean | null }>;
  const pharmacyRegistered = pharmacyRows.length;
  const pharmaciesActive = pharmacyRows.filter((row) => row.is_active).length;

  const { data: userRowsRaw } = await supabase.from('users').select('id, role');

  const userRows =
    (userRowsRaw ?? []) as Array<{ id: string; role: 'patient' | 'pharmacy' | string | null }>;
  const totalUsers = userRows.length;
  const patientUsers = userRows.filter((user) => user.role === 'patient').length;
  const pharmacyUsers = userRows.filter((user) => user.role === 'pharmacy').length;

  const { data: drugsRowsRaw } = await supabase
    .from('drugs')
    .select('pharmacy_id, quantity_in_stock')
    .gt('quantity_in_stock', 0);

  const drugsRows =
    (drugsRowsRaw ?? []) as Array<{ pharmacy_id: string | null; quantity_in_stock: number | null }>;
  const contributingPharmacies = new Set(
    drugsRows.map((row) => row.pharmacy_id).filter((id): id is string => Boolean(id))
  ).size;

  const { count: totalSearches = 0 } = await supabase
    .from('searches')
    .select('id', { count: 'exact', head: true });

  const { data: searchSamplesRaw } = await supabase
    .from('searches')
    .select('query_text, location, timestamp')
    .order('timestamp', { ascending: false })
    .limit(1000);

  const searchSamples =
    (searchSamplesRaw ?? []) as Array<{
      query_text: string | null;
      location: string | null;
      timestamp: string | null;
    }>;

  const queryCounts = new Map<string, number>();
  const locationCounts = new Map<string, number>();
  const hourCounts = Array.from({ length: 24 }, () => 0);

  searchSamples.forEach((search) => {
    const query = search.query_text?.trim().toLowerCase();
    if (query) {
      queryCounts.set(query, (queryCounts.get(query) ?? 0) + 1);
    }

    const location = search.location?.trim();
    if (location) {
      const locKey = location.toLowerCase();
      locationCounts.set(locKey, (locationCounts.get(locKey) ?? 0) + 1);
    } else {
      locationCounts.set('unspecified', (locationCounts.get('unspecified') ?? 0) + 1);
    }

    if (search.timestamp) {
      const hour = new Date(search.timestamp).getHours();
      if (!Number.isNaN(hour)) {
        hourCounts[hour] += 1;
      }
    }
  });

  const totalSamples = searchSamples.length;

  const topMedications = Array.from(queryCounts.entries())
    .map(([name, count]) => ({
      name,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const locationStats = Array.from(locationCounts.entries())
    .map(([location, count]) => ({
      location: location === 'unspecified' ? 'Unspecified' : location.replace(/\b\w/g, (c) => c.toUpperCase()),
      count,
      percent: totalSamples ? Math.round((count / totalSamples) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const peakHourIndex = hourCounts.reduce(
    (maxIdx, count, idx, arr) => (count > arr[maxIdx] ? idx : maxIdx),
    0
  );
  const peakHourShare =
    totalSamples > 0 ? Math.round((hourCounts[peakHourIndex] / totalSamples) * 100) : 0;
  const eveningCount = hourCounts.slice(18).reduce((sum, value) => sum + value, 0);
  const eveningShare = totalSamples > 0 ? Math.round((eveningCount / totalSamples) * 100) : 0;

  const keyInsight =
    totalSamples > 0
      ? eveningShare >= 10
        ? `${eveningShare}% of searches happen after 6pm—demand peaks when pharmacies are winding down.`
        : `${peakHourShare}% of searches cluster around ${formatHourLabel(
            peakHourIndex
          )}, showing when patients are most active.`
      : 'We’re just getting started—every new search gives us signal no incumbent sees.';

  return (
    <div className="min-h-screen bg-white py-12 px-4">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <header className="flex flex-col gap-4 text-center">
          <span className="text-sm font-semibold tracking-[0.2em] text-primary-blue uppercase">
            StocMed Intelligence
          </span>
          <h1 className="text-4xl font-bold text-dark-gray sm:text-5xl">
            Demand Signals & Platform Momentum
          </h1>
          <p className="text-base text-medium-gray sm:text-lg">
            Snapshot of patient demand and pharmacy inventory activity across the StocMed network.
          </p>
        </header>

        <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: 'Users onboarded',
              value: totalUsers,
              detail: `${patientUsers.toLocaleString()} patients · ${pharmacyUsers.toLocaleString()} pharmacies`,
            },
            {
              label: 'Pharmacies sharing inventory',
              value: contributingPharmacies,
              detail: `${pharmacyRegistered.toLocaleString()} registered · ${pharmaciesActive.toLocaleString()} active`,
            },
            {
              label: 'Medications listed',
              value: medicationsListed,
              detail: 'Unique SKUs currently available on the network',
            },
            {
              label: 'Total searches captured',
              value: totalSearches,
              detail: 'Patient intents logged in real time',
            },
          ].map((item) => (
            <Card key={item.label} className="border-blue-100 bg-blue-50/40">
              <CardHeader>
                <CardTitle className="text-sm font-medium uppercase tracking-wide text-primary-blue">
                  {item.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-dark-gray">
                  {(item.value ?? 0).toLocaleString()}
                </p>
                <p className="mt-2 text-xs text-medium-gray leading-relaxed">
                  {item.detail}
                </p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle>Top 5 searched medications</CardTitle>
            </CardHeader>
            <CardContent>
              {topMedications.length > 0 ? (
                <ol className="space-y-3">
                  {topMedications.map((item, index) => (
                    <li key={item.name} className="flex items-center justify-between">
                      <span className="font-medium text-gray-800">
                        {index + 1}. {item.name}
                      </span>
                      <span className="text-sm text-medium-gray">
                        {item.count.toLocaleString()} searches
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-medium-gray">
                  We’re still gathering search volume—it builds with every patient interaction.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle>Where searches originate</CardTitle>
            </CardHeader>
            <CardContent>
              {locationStats.length > 0 ? (
                <ul className="space-y-3">
                  {locationStats.map((item) => (
                    <li
                      key={item.location}
                      className="flex items-center justify-between border-b border-gray-100 pb-2 last:border-0 last:pb-0"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-800">{item.location}</span>
                        <span className="text-xs text-medium-gray">
                          {item.count.toLocaleString()} searches
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-primary-blue">
                        {item.percent}%
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-medium-gray">
                  Location data is being collected—early users are teaching us where demand lives.
                </p>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle>Peak search windows</CardTitle>
            </CardHeader>
            <CardContent>
              {totalSamples > 0 ? (
                <div className="space-y-3">
                  <p className="text-2xl font-semibold text-dark-gray">
                    {formatHourLabel(peakHourIndex)} · {peakHourShare}% of observed searches
                  </p>
                  <p className="text-sm text-medium-gray">
                    Evening demand (after 6pm) accounts for {eveningShare}% of searches.
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                    {hourCounts.map((count, hour) =>
                      count > 0 ? (
                        <span
                          key={hour}
                          className="rounded-full bg-light-blue-bg px-3 py-1 font-medium"
                        >
                          {formatHourLabel(hour)} • {Math.round((count / totalSamples) * 100)}%
                        </span>
                      ) : null
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-medium-gray">
                  We’ll surface time-of-day trends as more patients engage with the assistant.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-200 bg-gradient-to-br from-primary-blue/10 via-white to-white">
            <CardHeader>
              <CardTitle>Key finding</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-semibold text-dark-gray">{keyInsight}</p>
              <p className="mt-4 text-sm text-medium-gray">
                Even with early users, we capture demand signals invisible to existing players.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
