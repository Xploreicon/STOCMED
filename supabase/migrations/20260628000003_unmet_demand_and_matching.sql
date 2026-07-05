-- Create trigram fuzzy matching function for products
CREATE OR REPLACE FUNCTION public.match_catalogue_product(search_query text)
RETURNS TABLE (
    id UUID,
    generic_name TEXT,
    brand_name TEXT,
    manufacturer TEXT,
    strength TEXT,
    dosage_form TEXT,
    category TEXT,
    pack_size TEXT,
    confidence NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.generic_name,
        p.brand_name,
        p.manufacturer,
        p.strength,
        p.dosage_form,
        p.category,
        p.pack_size,
        GREATEST(
            similarity(p.generic_name, search_query), 
            similarity(COALESCE(p.brand_name, ''), search_query)
        )::numeric AS confidence
    FROM public.products p
    WHERE p.generic_name % search_query 
       OR p.brand_name % search_query
       OR p.generic_name ILIKE '%' || search_query || '%'
       OR p.brand_name ILIKE '%' || search_query || '%'
    ORDER BY confidence DESC
    LIMIT 5;
END;
$$;
