-- Replace the inventory screen's many sequential PostgREST reads with one
-- owner-scoped, set-based snapshot. This migration is read-only with respect
-- to inventory and catalogue contents.

CREATE OR REPLACE FUNCTION public.get_pharmacy_inventory_enriched(
  p_pharmacy_id UUID,
  p_show_delisted BOOLEAN DEFAULT FALSE
)
-- One JSON value carries the complete snapshot past PostgREST's configured
-- maximum-row limit; returning SETOF would truncate large pharmacies at 1,000.
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH owned_inventory AS MATERIALIZED (
    SELECT
      pi.*,
      ph.reservations_enabled AS pharmacy_reservations_enabled
    FROM public.pharmacy_inventory AS pi
    JOIN public.pharmacies AS ph ON ph.id = pi.pharmacy_id
    WHERE pi.pharmacy_id = p_pharmacy_id
      AND (p_show_delisted OR pi.deleted_at IS NULL)
      AND (
        COALESCE(auth.role(), '') = 'service_role'
        OR ph.user_id = auth.uid()
      )
  ),
  active_reservations AS MATERIALIZED (
    SELECT
      r.inventory_id,
      r.batch_id,
      SUM(r.quantity)::INTEGER AS reserved_quantity
    FROM public.reservations AS r
    JOIN owned_inventory AS oi ON oi.id = r.inventory_id
    WHERE oi.pharmacy_reservations_enabled = TRUE
      AND r.status = 'active'
      AND r.expires_at > NOW()
    GROUP BY r.inventory_id, r.batch_id
  ),
  reservations_by_inventory AS (
    SELECT
      ar.inventory_id,
      SUM(ar.reserved_quantity)::INTEGER AS reserved_quantity
    FROM active_reservations AS ar
    GROUP BY ar.inventory_id
  ),
  reservations_by_batch AS (
    SELECT
      ar.batch_id,
      SUM(ar.reserved_quantity)::INTEGER AS reserved_quantity
    FROM active_reservations AS ar
    WHERE ar.batch_id IS NOT NULL
    GROUP BY ar.batch_id
  ),
  movement_totals AS MATERIALIZED (
    SELECT
      sm.batch_id,
      SUM(sm.quantity)::INTEGER AS ledger_remaining
    FROM public.stock_movements AS sm
    JOIN owned_inventory AS oi ON oi.id = sm.inventory_id
    WHERE sm.batch_id IS NOT NULL
    GROUP BY sm.batch_id
  ),
  batch_payloads AS (
    SELECT
      b.inventory_id,
      JSONB_AGG(
        TO_JSONB(b) || JSONB_BUILD_OBJECT(
          '__ledger_remaining', COALESCE(mt.ledger_remaining, b.quantity_received),
          '__reserved_quantity', COALESCE(rbb.reserved_quantity, 0)
        )
        ORDER BY b.created_at, b.id
      ) AS batches
    FROM public.batches AS b
    JOIN owned_inventory AS oi ON oi.id = b.inventory_id
    LEFT JOIN movement_totals AS mt ON mt.batch_id = b.id
    LEFT JOIN reservations_by_batch AS rbb ON rbb.batch_id = b.id
    GROUP BY b.inventory_id
  ),
  selling_unit_payloads AS (
    SELECT
      su.inventory_id,
      JSONB_AGG(TO_JSONB(su) ORDER BY su.sort_order, su.created_at, su.id) AS selling_units
    FROM public.selling_units AS su
    JOIN owned_inventory AS oi ON oi.id = su.inventory_id
    GROUP BY su.inventory_id
  )
  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'inventory', TO_JSONB(oi) - 'pharmacy_reservations_enabled',
        'product', CASE WHEN p.id IS NULL THEN NULL ELSE TO_JSONB(p) END,
        'batches', COALESCE(bp.batches, '[]'::JSONB),
        'selling_units', COALESCE(sup.selling_units, '[]'::JSONB),
        'reserved_quantity', COALESCE(rbi.reserved_quantity, 0)::INTEGER,
        'sellable_quantity', GREATEST(
            oi.quantity_in_stock - COALESCE(rbi.reserved_quantity, 0),
            0
          )::INTEGER
      )
      ORDER BY oi.created_at DESC, oi.id ASC
    ),
    '[]'::JSONB
  )
  FROM owned_inventory AS oi
  LEFT JOIN public.products AS p ON p.id = oi.product_id
  LEFT JOIN reservations_by_inventory AS rbi ON rbi.inventory_id = oi.id
  LEFT JOIN batch_payloads AS bp ON bp.inventory_id = oi.id
  LEFT JOIN selling_unit_payloads AS sup ON sup.inventory_id = oi.id;
$function$;

REVOKE ALL ON FUNCTION public.get_pharmacy_inventory_enriched(UUID, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pharmacy_inventory_enriched(UUID, BOOLEAN)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
