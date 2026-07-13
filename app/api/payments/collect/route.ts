import { NextRequest, NextResponse } from 'next/server'

/**
 * REGULATORY GUARD — STOCMED_MEDIATED_COLLECTION
 *
 * This route exists solely to enforce the regulatory constraint that
 * money does NOT flow through StocMed. The STOCMED_MEDIATED_COLLECTION
 * flag must be checked at RUNTIME (the audit found it exists in env but
 * was not enforced in code).
 *
 * When the flag is false (default), ALL requests are rejected with 403.
 * When true, this endpoint would proxy to a payment collection service.
 * As of this build, the flag MUST remain false for all deployments.
 */
export async function POST(request: NextRequest) {
  const mediatedCollectionEnabled =
    process.env.NEXT_PUBLIC_STOCMED_MEDIATED_COLLECTION === 'true' ||
    process.env.STOCMED_MEDIATED_COLLECTION === 'true'

  if (!mediatedCollectionEnabled) {
    return NextResponse.json(
      {
        error: 'STOCMED_MEDIATED_COLLECTION is disabled. Money does not flow through StocMed. Payment methods are recorded locally — accounting is exported to QuickBooks.',
        code: 'MEDIATED_COLLECTION_DISABLED',
      },
      { status: 403 }
    )
  }

  // If somehow enabled in future, this would be the integration point.
  // For now, even if the flag is true, we return 501 (Not Implemented)
  // since no payment processor is integrated.
  return NextResponse.json(
    {
      error: 'Payment collection is not yet implemented. Contact support.',
      code: 'NOT_IMPLEMENTED',
    },
    { status: 501 }
  )
}

// Also block GET to prevent accidental probing
export async function GET() {
  return NextResponse.json(
    {
      error: 'STOCMED_MEDIATED_COLLECTION is disabled. This endpoint has no public interface.',
      code: 'MEDIATED_COLLECTION_DISABLED',
    },
    { status: 403 }
  )
}
