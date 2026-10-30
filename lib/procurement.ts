export type ProcurementProduct = {
  id: string; generic_name: string; brand_name: string | null; strength: string
  dosage_form: string | null; pack_size: string | null; barcode: string | null
  target_type: 'medicine' | 'store'; product_id: string | null; inventory_id: string | null
  tracks_expiry: boolean; base_unit_name?: string; is_new?: boolean; selling_price?: number
  deleted_at?: string | null; recovery_expires_at?: string | null
}

export const procurementProductLabel = (product: ProcurementProduct) => [
  product.brand_name, product.generic_name, product.strength, product.dosage_form,
  product.pack_size ? `Pack: ${product.pack_size}` : '',
].filter(Boolean).join(' · ')

export function receivingBaseQuantity(line: { quantity_received: number; units_per_pack: number }) {
  return line.quantity_received * line.units_per_pack
}

// Kept across failed requests and page reloads. An identical retry keeps its key;
// a successful receipt clears it before the next delivery is started.
export function receiptRequest(payload: Record<string, unknown>, previous: { payload: string; key: string } | null) {
  const serialized = JSON.stringify(payload)
  return previous?.payload === serialized ? previous : { payload: serialized, key: crypto.randomUUID() }
}
