-- Anonymous local price guidance. No peer identity or individual price is
-- returned, and at least three other visible pharmacies must contribute.
CREATE OR REPLACE FUNCTION public.set_price_benchmark_radius(p_radius_km NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE v_pharmacy_id UUID:=public.authenticated_pharmacy_id(); v_settings JSONB;
BEGIN
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF p_radius_km IS NULL OR p_radius_km<1 OR p_radius_km>50 THEN RAISE EXCEPTION 'Radius must be between 1 and 50 kilometres'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pharmacy_features WHERE pharmacy_id=v_pharmacy_id AND feature_key='price_benchmark' AND is_enabled)
    THEN RAISE EXCEPTION 'The price benchmark feature is disabled' USING ERRCODE='42501'; END IF;
  UPDATE public.pharmacy_features SET settings=jsonb_set(settings,'{radius_km}',to_jsonb(ROUND(p_radius_km,1)),TRUE),updated_at=NOW()
  WHERE pharmacy_id=v_pharmacy_id AND feature_key='price_benchmark'
  RETURNING settings INTO v_settings;
  RETURN jsonb_build_object('success',TRUE,'radius_km',(v_settings->>'radius_km')::NUMERIC);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_local_price_benchmark(p_inventory_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE
  v_pharmacy_id UUID:=public.authenticated_pharmacy_id();
  v_product_id UUID; v_current_price NUMERIC; v_lat DOUBLE PRECISION; v_lng DOUBLE PRECISION;
  v_radius NUMERIC; v_count INTEGER; v_average NUMERIC; v_min NUMERIC; v_max NUMERIC; v_percentile NUMERIC;
BEGIN
  IF v_pharmacy_id IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pharmacy_features WHERE pharmacy_id=v_pharmacy_id AND feature_key='price_benchmark' AND is_enabled)
    THEN RAISE EXCEPTION 'The price benchmark feature is disabled' USING ERRCODE='42501'; END IF;
  SELECT inventory.product_id,inventory.price,pharmacy.latitude,pharmacy.longitude,
    LEAST(50,GREATEST(1,COALESCE(NULLIF(feature.settings->>'radius_km','')::NUMERIC,5)))
  INTO v_product_id,v_current_price,v_lat,v_lng,v_radius
  FROM public.pharmacy_inventory inventory
  JOIN public.pharmacies pharmacy ON pharmacy.id=inventory.pharmacy_id
  JOIN public.pharmacy_features feature ON feature.pharmacy_id=pharmacy.id AND feature.feature_key='price_benchmark'
  WHERE inventory.id=p_inventory_id AND inventory.pharmacy_id=v_pharmacy_id AND inventory.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item not found'; END IF;
  IF v_product_id IS NULL THEN RETURN jsonb_build_object('available',FALSE,'code','CATALOGUE_PRODUCT_REQUIRED','radius_km',v_radius,'message','Local guidance is available for catalogue medicines.'); END IF;
  IF v_lat IS NULL OR v_lng IS NULL THEN RETURN jsonb_build_object('available',FALSE,'code','LOCATION_REQUIRED','radius_km',v_radius,'message','Add your pharmacy map location to compare local prices.'); END IF;

  WITH peers AS MATERIALIZED (
    SELECT DISTINCT ON (peer.id) inventory.price::NUMERIC peer_price
    FROM public.pharmacies peer
    JOIN public.pharmacy_inventory inventory ON inventory.pharmacy_id=peer.id
    WHERE peer.id<>v_pharmacy_id AND peer.is_active=TRUE
      AND peer.latitude IS NOT NULL AND peer.longitude IS NOT NULL
      AND inventory.product_id=v_product_id AND inventory.is_listed=TRUE
      AND inventory.deleted_at IS NULL AND inventory.quantity_in_stock>0
      AND 6371*ACOS(LEAST(1,GREATEST(-1,
        COS(RADIANS(v_lat))*COS(RADIANS(peer.latitude))*COS(RADIANS(peer.longitude)-RADIANS(v_lng))
        +SIN(RADIANS(v_lat))*SIN(RADIANS(peer.latitude))
      )))<=v_radius
    ORDER BY peer.id,inventory.updated_at DESC
  )
  SELECT COUNT(*)::INTEGER,ROUND(AVG(peer_price),2),MIN(peer_price),MAX(peer_price),
    ROUND(100.0*COUNT(*) FILTER (WHERE peer_price<=v_current_price)/NULLIF(COUNT(*),0),1)
  INTO v_count,v_average,v_min,v_max,v_percentile FROM peers;

  IF v_count<3 THEN RETURN jsonb_build_object(
    'available',FALSE,'code','PRIVACY_THRESHOLD','peer_count',v_count,'minimum_pharmacies',3,'radius_km',v_radius,
    'message','Price guidance appears when at least three nearby pharmacies stock this medicine.'
  ); END IF;
  RETURN jsonb_build_object(
    'available',TRUE,'peer_count',v_count,'radius_km',v_radius,'pharmacy_price',v_current_price,
    'local_average',v_average,'local_min',v_min,'local_max',v_max,'percentile',v_percentile
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_price_benchmark_radius(NUMERIC) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_local_price_benchmark(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_price_benchmark_radius(NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_local_price_benchmark(UUID) TO authenticated;
