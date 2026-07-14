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
import { Loader2, AlertCircle, Camera, X, ImageIcon, Pill } from 'lucide-react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

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

  const [formData, setFormData] = useState({
    price: '',
    low_stock_threshold: '',
  });
  const [formError, setFormError] = useState<string | null>(null);

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
    mutationFn: async (data: any) => {
      const response = await fetch(`/api/pharmacy/drugs/${drug.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

      await editDrugMutation.mutateAsync(payload);
    } catch (error: any) {
      setFormError(error.message || 'Failed to update drug');
    } finally {
      setIsUploading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  if (!drug) return null;

  const displayImage = pharmacyImagePreview || catalogueImagePreview || null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md p-0 border border-border rounded-xl shadow-2xl overflow-hidden">
        <DialogHeader className="p-6 border-b bg-surface/50">
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

        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-6">
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
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 p-6 border-t bg-surface/50">
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
  );
}
