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
import { Loader2, AlertCircle, Camera, X } from 'lucide-react';
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

  // Image states
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (drug) {
      setFormData({
        price: drug.price?.toString() || '',
        low_stock_threshold: drug.low_stock_threshold?.toString() || '10',
      });
      setImagePreview(drug.image_url || null);
      setImageFile(null);
      setUploadError(null);
      setIsUploading(false);
      setFormError(null);
    }
  }, [drug]);

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setImageFile(null);
      setImagePreview(drug?.image_url || null);
      return;
    }

    if (!file.type.startsWith('image/')) {
      setUploadError('Please select a valid image file (PNG or JPG).');
      return;
    }

    if (file.size > 1024 * 1024) {
      setUploadError('Image size must be 1MB or less.');
      return;
    }

    setUploadError(null);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setUploadError(null);
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
      let imageUrl = drug.image_url;

      if (imagePreview === null) {
        imageUrl = null;
      } else if (imageFile) {
        setIsUploading(true);
        const supabase = createClient();
        const fileExt = imageFile.name.split('.').pop()?.toLowerCase() || 'jpg';
        const uniqueId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const filePath = `drugs/${uniqueId}.${fileExt}`;

        const { error: uploadErr } = await supabase.storage
          .from('drug-images')
          .upload(filePath, imageFile, {
            cacheControl: '3600',
            contentType: imageFile.type,
            upsert: false,
          });

        if (uploadErr) {
          throw new Error(uploadErr.message);
        }

        const { data: { publicUrl } } = supabase.storage.from('drug-images').getPublicUrl(filePath);
        imageUrl = publicUrl;
      }

      await editDrugMutation.mutateAsync({
        price: parseFloat(formData.price),
        low_stock_threshold: parseInt(formData.low_stock_threshold),
        image_url: imageUrl,
      });
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
            {/* Display Locked Product Attributes */}
            <div className="bg-surface border border-border rounded-lg p-4 flex gap-4">
              {imagePreview ? (
                <div className="relative h-16 w-16 rounded-lg overflow-hidden border border-border bg-white shrink-0 group">
                  <Image
                    src={imagePreview}
                    alt={drug.brand_name || drug.name || drug.generic_name}
                    fill
                    sizes="64px"
                    className="object-cover"
                    unoptimized
                  />
                  <Button
                    type="button"
                    onClick={clearImage}
                    className="absolute top-0.5 right-0.5 bg-white/90 hover:bg-white text-ink rounded-full p-0.5 border border-border shadow transition-transform hover:scale-110"
                    title="Remove image"
                    disabled={editDrugMutation.isPending || isUploading}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <label className="cursor-pointer flex flex-col items-center justify-center h-16 w-16 rounded-lg border border-dashed border-border hover:border-primary/50 hover:bg-surface/50 bg-white shrink-0 transition-all shadow-sm">
                  <Camera className="w-5 h-5 text-ink-light mb-0.5" />
                  <span className="text-[8px] font-medium text-ink-muted">Add Image</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={handleImageChange}
                    disabled={editDrugMutation.isPending || isUploading}
                  />
                </label>
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
