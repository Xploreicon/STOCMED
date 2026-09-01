'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, AlertCircle, Camera, X, ImageIcon, PackagePlus, Pill, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { SpAuthorizationModal } from '@/components/pharmacy/SpAuthorizationModal';
import {
  clearCachedSpToken,
  getCachedSpToken,
  isSpAuthorizationRequired,
  spAuthorizationRequiredError,
  withSpAuthorizationHeader,
} from '@/lib/sp-authorization-client';
import { usePharmacyFeatures } from '@/components/providers/PharmacyFeaturesProvider';
import { withStaffSessionHeader } from '@/lib/staff-session-client';
import { PriceBenchmarkGuidance } from '@/components/pharmacy/PriceBenchmarkGuidance';
import { StoreMedicinePromotion } from '@/components/pharmacy/StoreMedicinePromotion';

interface EditDrugModalProps {
  isOpen: boolean;
  onClose: () => void;
  drug: any;
  onSuccess: () => void;
}

export default function EditDrugModal({
  isOpen,
  onClose,
  drug,
  onSuccess,
}: EditDrugModalProps) {
  const queryClient = useQueryClient();
  const { isEnabled } = usePharmacyFeatures();

  const [formData, setFormData] = useState({
    price: '',
    low_stock_threshold: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [packForm, setPackForm] = useState({ unitName: '', unitsPer: '', price: '', barcode: '' });
  const [isSavingPack, setIsSavingPack] = useState(false);
  const [spRequest, setSpRequest] = useState<null | {
    description: string;
    run: (token: string | null) => Promise<void>;
  }>(null);

  // Pharmacy-level image states
  const [pharmacyImageFile, setPharmacyImageFile] = useState<File | null>(null);
  const [pharmacyImagePreview, setPharmacyImagePreview] = useState<string | null>(null);

  // Catalogue-level image states
  const [catalogueImageFile, setCatalogueImageFile] = useState<File | null>(null);
  const [catalogueImagePreview, setCatalogueImagePreview] = useState<string | null>(null);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (drug) {
      setFormData({
        price: drug.price?.toString() || '',
        low_stock_threshold: drug.low_stock_threshold?.toString() || '10',
      });
      setPharmacyImagePreview(drug.pharmacy_image_url || null);
      setCatalogueImagePreview(drug.image_url || null);
      setPharmacyImageFile(null);
      setCatalogueImageFile(null);
      setUploadError(null);
      setIsUploading(false);
      setFormError(null);
      setPackForm({ unitName: '', unitsPer: '', price: '', barcode: '' });
    }
  }, [drug]);

  const validateImageFile = (file: File): string | null => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return 'Please select a valid image file (PNG, JPG, or WebP).';
    }
    if (file.size > 1024 * 1024) {
      return 'Image size must be 1MB or less.';
    }
    return null;
  };

  const handlePharmacyImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const error = validateImageFile(file);
    if (error) { setUploadError(error); return; }
    setUploadError(null);
    setPharmacyImageFile(file);
    setPharmacyImagePreview(URL.createObjectURL(file));
  };

  const handleCatalogueImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const error = validateImageFile(file);
    if (error) { setUploadError(error); return; }
    setUploadError(null);
    setCatalogueImageFile(file);
    setCatalogueImagePreview(URL.createObjectURL(file));
  };

  const clearPharmacyImage = () => {
    setPharmacyImageFile(null);
    setPharmacyImagePreview(null);
    setUploadError(null);
  };

  const clearCatalogueImage = () => {
    setCatalogueImageFile(null);
    setCatalogueImagePreview(null);
    setUploadError(null);
  };

  const uploadImage = async (file: File): Promise<string> => {
    const supabase = createClient();
    const fileExt = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const uniqueId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const filePath = `drugs/${uniqueId}.${fileExt}`;

    const { error: uploadErr } = await supabase.storage
      .from('drug-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        contentType: file.type,
        upsert: false,
      });

    if (uploadErr) throw new Error(uploadErr.message);

    const { data: { publicUrl } } = supabase.storage.from('drug-images').getPublicUrl(filePath);
    return publicUrl;
  };

  const editDrugMutation = useMutation({
    mutationFn: async ({ data, token }: { data: any; token?: string | null }) => {
      const response = await fetch(`/api/pharmacy/drugs/${drug.id}`, {
        method: 'PATCH',
        headers: withStaffSessionHeader(withSpAuthorizationHeader('price_change', token ?? null, { 'Content-Type': 'application/json' })),
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        if (response.status === 403 && error.code === 'SP_AUTH_REQUIRED') {
          clearCachedSpToken('price_change');
          throw spAuthorizationRequiredError(error.error || 'Superintendent authorization is required.');
        }
        throw new Error(error.error || 'Failed to update drug');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['pharmacy-drugs'],
        refetchType: 'active',
      });
      queryClient.invalidateQueries({
        queryKey: ['pharmacy-stats'],
        refetchType: 'active',
      });
      onSuccess();
    },
  });

  const runPriceChange = async (description: string, operation: (token: string | null) => Promise<void>) => {
    try {
      await operation(getCachedSpToken('price_change'));
    } catch (error) {
      if (!isSpAuthorizationRequired(error)) throw error;
      clearCachedSpToken('price_change');
      setSpRequest({ description, run: operation });
    }
  };

  const saveDrug = async (token?: string | null) => {
    setFormError(null);

    try {
      setIsUploading(true);

      // Resolve pharmacy-level image
      let pharmacyImageUrl: string | null | undefined = undefined;
      if (pharmacyImagePreview === null && drug.pharmacy_image_url) {
        // User explicitly cleared the pharmacy image
        pharmacyImageUrl = null;
      } else if (pharmacyImageFile) {
        pharmacyImageUrl = await uploadImage(pharmacyImageFile);
      }

      // Resolve catalogue-level image
      let catalogueImageUrl: string | null | undefined = undefined;
      if (catalogueImagePreview === null && drug.image_url) {
        catalogueImageUrl = null;
      } else if (catalogueImageFile) {
        catalogueImageUrl = await uploadImage(catalogueImageFile);
      }

      const payload: any = {
        price: parseFloat(formData.price),
        low_stock_threshold: parseInt(formData.low_stock_threshold),
      };
      if (pharmacyImageUrl !== undefined) payload.pharmacy_image_url = pharmacyImageUrl;
      if (catalogueImageUrl !== undefined) payload.image_url = catalogueImageUrl;

      await editDrugMutation.mutateAsync({ data: payload, token });
    } catch (error: any) {
      if (isSpAuthorizationRequired(error)) throw error;
      setFormError(error.message || 'Failed to update drug');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Number(formData.price) !== Number(drug.price)) {
      await runPriceChange(
        `Authorise changing the price of ${drug.brand_name || drug.generic_name || 'this inventory item'}`,
        async (token) => saveDrug(token),
      );
      return;
    }
    await saveDrug(null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const addPackPrice = async (token: string | null) => {
    setIsSavingPack(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/pharmacy/inventory/${drug.id}/selling-units`, {
        method: 'POST',
        headers: withSpAuthorizationHeader('price_change', token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(packForm),
      });
      const payload = await response.json();
      if (response.status === 403 && payload?.code === 'SP_AUTH_REQUIRED') {
        clearCachedSpToken('price_change');
        throw spAuthorizationRequiredError(payload.error || 'Superintendent authorization is required.');
      }
      if (!response.ok) throw new Error(payload.error || 'Could not add the pack price');
      setPackForm({ unitName: '', unitsPer: '', price: '', barcode: '' });
      await queryClient.invalidateQueries({ queryKey: ['pharmacy-drugs'] });
      onSuccess();
    } catch (error) {
      if (isSpAuthorizationRequired(error)) throw error;
      setFormError(error instanceof Error ? error.message : 'Could not add the pack price');
    } finally {
      setIsSavingPack(false);
    }
  };

  const removePackPrice = async (sellingUnitId: string, token: string | null) => {
    setIsSavingPack(true);
    try {
      const response = await fetch(`/api/pharmacy/inventory/${drug.id}/selling-units?sellingUnitId=${sellingUnitId}`, {
        method: 'DELETE',
        headers: withSpAuthorizationHeader('price_change', token),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 403 && payload?.code === 'SP_AUTH_REQUIRED') {
        clearCachedSpToken('price_change');
        throw spAuthorizationRequiredError(payload.error || 'Superintendent authorization is required.');
      }
      if (!response.ok) throw new Error(payload?.error || 'Could not remove the pack price');
      await queryClient.invalidateQueries({ queryKey: ['pharmacy-drugs'] });
      onSuccess();
    } catch (error) {
      if (isSpAuthorizationRequired(error)) throw error;
      setFormError(error instanceof Error ? error.message : 'Could not remove the pack price');
    } finally {
      setIsSavingPack(false);
    }
  };

  if (!drug) return null;

  const displayImage = pharmacyImagePreview || catalogueImagePreview || null;

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] max-w-md flex-col overflow-hidden rounded-xl border border-border p-0 shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
        <DialogHeader className="shrink-0 border-b bg-surface/50 p-6">
          <DialogTitle className="text-xl font-semibold text-ink">
            Edit Inventory Details
          </DialogTitle>
        </DialogHeader>

        {formError && (
          <div className="mx-6 mt-4 p-3 bg-danger/5 border border-danger/20 text-danger rounded-md flex items-start gap-2 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-6">
            {/* Product info header with display image */}
            <div className="bg-surface border border-border rounded-lg p-4 flex gap-4">
              {displayImage ? (
                <div className="relative h-16 w-16 rounded-lg overflow-hidden border border-border bg-white shrink-0">
                  <Image
                    src={displayImage}
                    alt={drug.brand_name || drug.name || drug.generic_name}
                    fill
                    sizes="64px"
                    className="object-cover"
                    unoptimized
                  />
                </div>
              ) : (
                <div className="h-16 w-16 rounded-lg bg-white border border-dashed border-border flex items-center justify-center shrink-0">
                  <Pill className="w-6 h-6 text-muted-foreground/30" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-semibold text-ink-light uppercase tracking-wider">
                  Product Details (Locked)
                </h4>
                <div className="font-semibold text-ink mt-1 truncate">
                  {drug.brand_name ? `${drug.brand_name} (${drug.name || drug.generic_name})` : (drug.name || drug.generic_name)}
                </div>
                <div className="text-xs text-ink-muted mt-1 truncate">
                  {drug.strength} • {drug.dosage_form} • {drug.category}
                </div>
              </div>
            </div>

            {drug.item_type === 'store' && (
              <StoreMedicinePromotion
                inventoryId={drug.id}
                initialQuery={drug.item_name || drug.brand_name || drug.name || drug.generic_name || ''}
                disabled={editDrugMutation.isPending || isUploading}
                onPromoted={() => {
                  queryClient.invalidateQueries({ queryKey: ['pharmacy-drugs'], refetchType: 'active' });
                  queryClient.invalidateQueries({ queryKey: ['pharmacy-stats'], refetchType: 'active' });
                  onSuccess();
                }}
              />
            )}

            {/* Image Upload Section */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-ink-light uppercase tracking-wider">
                Product Images
              </h4>
              <div className="grid grid-cols-2 gap-3">
                {/* Pharmacy Image (Override) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-muted flex items-center gap-1">
                    <Camera className="w-3 h-3" />
                    Your Photo
                  </label>
                  {pharmacyImagePreview ? (
                    <div className="relative h-20 w-full rounded-lg overflow-hidden border border-border bg-white group">
                      <Image
                        src={pharmacyImagePreview}
                        alt="Pharmacy image"
                        fill
                        sizes="200px"
                        className="object-cover"
                        unoptimized
                      />
                      <Button
                        type="button"
                        onClick={clearPharmacyImage}
                        className="absolute top-1 right-1 bg-white/90 hover:bg-white text-ink rounded-full p-0.5 border border-border shadow transition-transform hover:scale-110"
                        disabled={editDrugMutation.isPending || isUploading}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ) : (
                    <label className="cursor-pointer flex flex-col items-center justify-center h-20 w-full rounded-lg border border-dashed border-border hover:border-primary/50 hover:bg-surface/50 bg-white transition-all">
                      <Camera className="w-5 h-5 text-ink-light mb-1" />
                      <span className="text-[9px] font-medium text-ink-muted">Upload Photo</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={handlePharmacyImageChange}
                        disabled={editDrugMutation.isPending || isUploading}
                      />
                    </label>
                  )}
                  <p className="text-[9px] text-ink-muted">Your own photo of this stock</p>
                </div>

                {/* Catalogue Image */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-muted flex items-center gap-1">
                    <ImageIcon className="w-3 h-3" />
                    Catalogue Image
                  </label>
                  {catalogueImagePreview ? (
                    <div className="relative h-20 w-full rounded-lg overflow-hidden border border-border bg-white group">
                      <Image
                        src={catalogueImagePreview}
                        alt="Catalogue image"
                        fill
                        sizes="200px"
                        className="object-cover"
                        unoptimized
                      />
                      <Button
                        type="button"
                        onClick={clearCatalogueImage}
                        className="absolute top-1 right-1 bg-white/90 hover:bg-white text-ink rounded-full p-0.5 border border-border shadow transition-transform hover:scale-110"
                        disabled={editDrugMutation.isPending || isUploading}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ) : (
                    <label className="cursor-pointer flex flex-col items-center justify-center h-20 w-full rounded-lg border border-dashed border-border hover:border-primary/50 hover:bg-surface/50 bg-white transition-all">
                      <ImageIcon className="w-5 h-5 text-ink-light mb-1" />
                      <span className="text-[9px] font-medium text-ink-muted">Add Image</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={handleCatalogueImageChange}
                        disabled={editDrugMutation.isPending || isUploading}
                      />
                    </label>
                  )}
                  <p className="text-[9px] text-ink-muted">Shared product photo (all pharmacies)</p>
                </div>
              </div>
            </div>

            {uploadError && (
              <p className="text-xs text-danger font-medium -mt-4">{uploadError}</p>
            )}

            <div className="grid grid-cols-2 gap-4 text-xs bg-surface/50 border border-border/50 rounded-lg p-3">
              <div>
                <span className="text-ink-light">Current Stock:</span>
                <span className="ml-1 font-semibold text-ink-muted">{drug.quantity_in_stock} units</span>
              </div>
              <div>
                <span className="text-ink-light">Earliest Expiry:</span>
                <span className="ml-1 font-semibold text-ink-muted">
                  {drug.expiry_date ? new Date(drug.expiry_date).toLocaleDateString() : 'N/A'}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1.5">
                  Price (₦) *
                </label>
                <Input
                  name="price"
                  type="number"
                  step="0.01"
                  value={formData.price}
                  onChange={handleChange}
                  required
                  placeholder="Enter price"
                  disabled={editDrugMutation.isPending || isUploading}
                />
              </div>

              {isEnabled('price_benchmark') && <PriceBenchmarkGuidance inventoryId={drug.id} />}

              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1.5">
                  Low Stock Threshold *
                </label>
                <Input
                  name="low_stock_threshold"
                  type="number"
                  value={formData.low_stock_threshold}
                  onChange={handleChange}
                  required
                  placeholder="e.g. 10"
                  disabled={editDrugMutation.isPending || isUploading}
                />
              </div>
            </div>

            {isEnabled('packs_and_units') && <section className="space-y-3 border-t border-border pt-5">
              <div>
                <h4 className="text-sm font-semibold text-ink">Pack prices</h4>
                <p className="mt-1 text-xs leading-5 text-ink-muted">
                  Optional. Stock always stays in base units; selling a pack deducts the number inside.
                </p>
              </div>
              {(drug.selling_units ?? []).map((unit: any) => (
                <div key={unit.id} className="flex items-center justify-between gap-3 rounded-button border border-border bg-surface px-3 py-2">
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium text-ink">{unit.unit_name} · {unit.units_per} units</p>
                    <p className="text-xs text-ink-muted">₦{Number(unit.price).toLocaleString()}{unit.barcode ? ` · ${unit.barcode}` : ''}</p>
                  </div>
                  <Button type="button" variant="ghost" disabled={isSavingPack} onClick={() => void runPriceChange(
                    `Authorise removing the ${unit.unit_name} pack price`,
                    async (token) => removePackPrice(unit.id, token),
                  )} className="h-9 w-9 p-0 text-danger">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder="What you call it" value={packForm.unitName} onChange={(event) => setPackForm((current) => ({ ...current, unitName: event.target.value }))} />
                <Input type="number" min="2" step="1" placeholder="Units inside" value={packForm.unitsPer} onChange={(event) => setPackForm((current) => ({ ...current, unitsPer: event.target.value }))} />
                <Input type="number" min="0.01" step="0.01" placeholder="Pack price" value={packForm.price} onChange={(event) => setPackForm((current) => ({ ...current, price: event.target.value }))} />
                <Input placeholder="Pack barcode (optional)" value={packForm.barcode} onChange={(event) => setPackForm((current) => ({ ...current, barcode: event.target.value }))} />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={isSavingPack || !packForm.unitName || !packForm.unitsPer || !packForm.price}
                onClick={() => void runPriceChange(
                  `Authorise adding a ${packForm.unitName || 'new'} pack price`,
                  addPackPrice,
                )}
                className="gap-2"
              >
                {isSavingPack ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
                Add a pack price
              </Button>
              {drug.item_type === 'medicine' && (drug.selling_units ?? []).length > 0 && (
                <label className="flex items-start gap-2 rounded-button bg-warning/5 p-3 text-xs leading-5 text-ink-muted">
                  <input
                    type="checkbox"
                    checked={drug.whole_pack_only === true}
                    onChange={async (event) => {
                      try {
                        await editDrugMutation.mutateAsync({ data: { whole_pack_only: event.target.checked } });
                      } catch (error) {
                        setFormError(error instanceof Error ? error.message : 'Could not update the pack rule');
                      }
                    }}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  Sell this POM as a whole pack only
                </label>
              )}
            </section>}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 justify-end gap-3 border-t bg-surface/50 p-6">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={editDrugMutation.isPending || isUploading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={editDrugMutation.isPending || isUploading}>
              {editDrugMutation.isPending || isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {isUploading ? 'Uploading...' : 'Saving...'}
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    <SpAuthorizationModal
      open={spRequest !== null}
      action="price_change"
      description={spRequest?.description ?? 'Authorise this price change'}
      onAuthorized={async (token) => {
        const request = spRequest;
        if (request) await request.run(token);
        setSpRequest(null);
      }}
      onClose={() => setSpRequest(null)}
    />
    </>
  );
}
