import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { triageQuery } from '@/lib/triage/classifier';
import { normalizeQuery } from '@/lib/triage/deterministic-classifier';

export async function POST(request: NextRequest) {
  try {
    const { query, thread_id } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required and must be a string' },
        { status: 400 }
      )
    }

    // Run the orchestrator triage engine
    const triageResult = await triageQuery(query);

    // Create anonymized query hash for privacy compliance
    const normalized = normalizeQuery(query);
    const queryHash = crypto
      .createHash('sha256')
      .update(normalized)
      .digest('hex');

    // Attempt to log audit trail to DB (graceful fallback if DB fails/offline)
    try {
      const supabase = await createClient();
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
