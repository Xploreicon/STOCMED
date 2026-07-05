CREATE OR REPLACE FUNCTION public.get_unmet_demand(
    p_pharmacy_id UUID,
    p_lat NUMERIC,
    p_lng NUMERIC,
    p_city TEXT
)
RETURNS TABLE (
    id UUID,
    generic_name TEXT,
    brand_name TEXT,
    strength TEXT,
    dosage_form TEXT,
    category TEXT,
    search_volume BIGINT,
    reason TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.generic_name,
        p.brand_name,
        p.strength,
        p.dosage_form,
        p.category,
        COUNT(s.id) AS search_volume,
        CASE 
            WHEN pi.id IS NULL THEN 'Not Stocked'::text
            ELSE 'Out of Stock'::text
        END AS reason
    FROM public.products p
    JOIN public.searches s ON (
        LOWER(p.generic_name) = LOWER(s.interpreted_query->'parsed'->>'name')
        OR LOWER(p.brand_name) = LOWER(s.interpreted_query->'parsed'->>'name')
        OR LOWER(s.query_text) = LOWER(p.generic_name)
        OR LOWER(s.query_text) = LOWER(p.brand_name)
    )
    LEFT JOIN public.pharmacy_inventory pi ON pi.product_id = p.id AND pi.pharmacy_id = p_pharmacy_id
    WHERE s.timestamp >= NOW() - INTERVAL '7 days'
      AND (
        (
          p_lat IS NOT NULL AND p_lng IS NOT NULL 
          AND (s.metadata->>'latitude') IS NOT NULL AND (s.metadata->>'longitude') IS NOT NULL
          AND (
            6371 * acos(
              cos(radians(p_lat)) * cos(radians((s.metadata->>'latitude')::numeric)) * 
              cos(radians((s.metadata->>'longitude')::numeric) - radians(p_lng)) + 
              sin(radians(p_lat)) * sin(radians((s.metadata->>'latitude')::numeric))
            )
          ) <= 15
        )
        OR (
          p_city IS NOT NULL 
          AND s.location IS NOT NULL
          AND LOWER(s.location) ILIKE '%' || LOWER(p_city) || '%'
        )
      )
      AND (pi.id IS NULL OR pi.quantity_in_stock = 0)
    GROUP BY p.id, p.generic_name, p.brand_name, p.strength, p.dosage_form, p.category, pi.id, pi.quantity_in_stock
    ORDER BY search_volume DESC
    LIMIT 5;
END;
$$;
