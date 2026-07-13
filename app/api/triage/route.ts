import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { triageQuery } from '@/lib/triage/classifier';
import { normalizeQuery } from '@/lib/triage/deterministic-classifier';
import { checkRateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const triagePayloadSchema = z.object({
  query: z.string().min(1).max(1000),
  thread_id: z.string().optional().nullable(),
});

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(request, 'triage', 20, 60_000);
  if (!rateLimit.success && rateLimit.response) {
    return rateLimit.response;
  }

  try {
    const rawJson = await request.json();
    const parsed = triagePayloadSchema.safeParse(rawJson);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid triage request payload', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { query, thread_id } = parsed.data;


    // Run the orchestrator triage engine
    const triageResult = await triageQuery(query);

    const supabase = await createClient();
    if (triageResult.intent === 'NAMED_OTC' || triageResult.intent === 'NAMED_POM') {
      const { data: matches } = await (supabase.rpc as any)('match_catalogue_product', {
        search_query: query,
      });
      const bestMatch = Array.isArray(matches) ? matches[0] : null;
      if (bestMatch && Number(bestMatch.confidence) >= 0.4) {
        triageResult.matched_product_id = bestMatch.id;
      }
    }

    // Create anonymized query hash for privacy compliance
    const normalized = normalizeQuery(query);
    const queryHash = crypto
      .createHash('sha256')
      .update(normalized)
      .digest('hex');

    // Attempt to log audit trail to DB (graceful fallback if DB fails/offline)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error: insertError } = await (supabase.from('triage_logs') as any)
        .insert({
          query_hash: queryHash,
          intent: triageResult.intent,
          risk_tier: triageResult.risk_tier,
          confidence: triageResult.confidence,
          layers_triggered: triageResult.layers_triggered,
          matched_product_id: triageResult.matched_product_id || null,
          thread_id: thread_id || null,
          user_id: user?.id || null,
        });

      if (insertError) {
        console.error('Failed to log triage result to database:', insertError);
      }
    } catch (dbError) {
      console.error('Database connection error in triage logging:', dbError);
    }

    return NextResponse.json(triageResult);
  } catch (error) {
    console.error('Unexpected error in triage API route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
