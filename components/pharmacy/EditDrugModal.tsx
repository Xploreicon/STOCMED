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
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import Image from 'next/image';

interface EditDrugModalProps {
  isOpen: boolean;
  onClose: () => void;
  drug: any;
  onSuccess: () => void;
}

const categories = [
  'Analgesics',
  'Antibiotics',
  'Antimalarials',
  'Antihypertensives',
  'Diabetes',
  'Vitamins',
  'Gastrointestinal',
  'Respiratory',
  'Others',
];

const dosageForms = [
  'tablet',
  'capsule',
  'syrup',
  'injection',
  'cream',
  'drops',
  'inhaler',
];

export default function EditDrugModal({
  isOpen,
  onClose,
  drug,
  onSuccess,
}: EditDrugModalProps) {
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    name: '',
    generic_name: '',
    brand_name: '',
    category: '',
    dosage_form: '',
    strength: '',
    price: '',
    quantity_in_stock: '',
    low_stock_threshold: '',
    manufacturer: '',
    description: '',
    requires_prescription: false,
    expiry_date: '',
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);

  useEffect(() => {
    if (drug) {
      setFormData({
        name: drug.name || '',
        generic_name: drug.generic_name || '',
        brand_name: drug.brand_name || '',
        category: drug.category || '',
        dosage_form: drug.dosage_form || '',
        strength: drug.strength || '',
        price: drug.price?.toString() || '',
        quantity_in_stock: drug.quantity_in_stock?.toString() || '',
        low_stock_threshold: drug.low_stock_threshold?.toString() || '10',
        manufacturer: drug.manufacturer || '',
        description: drug.description || '',
        requires_prescription: drug.requires_prescription || false,
        expiry_date: drug.expiry_date
          ? new Date(drug.expiry_date).toISOString().split('T')[0]
          : '',
      });
      setImagePreview(drug.image_url || null);
      setImageFile(null);
      setUploadError(null);
      setRemoveExistingImage(false);
    }
  }, [drug]);

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
      queryClient.invalidateQueries({ queryKey: ['pharmacy-drugs'] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stats'] });
      onSuccess();
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      let imageUrl =
        removeExistingImage && !imageFile ? null : (drug.image_url as string | null);

      if (imageFile) {
        setIsUploading(true);
        const supabase = createClient();
        const fileExt = imageFile.name.split('.').pop()?.toLowerCase() || 'jpg';
        const uniqueName =
          (typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) +
          `.${fileExt}`;
        const filePath = `drugs/${uniqueName}`;

        const { error: uploadError } = await supabase.storage
          .from('drug-images')
          .upload(filePath, imageFile, {
            cacheControl: '3600',
            contentType: imageFile.type,
            upsert: false,
          });

        if (uploadError) {
          setUploadError(uploadError.message);
          throw uploadError;
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from('drug-images').getPublicUrl(filePath);

        imageUrl = publicUrl;
      }

      await editDrugMutation.mutateAsync({
        name: formData.name,
        generic_name: formData.generic_name || null,
        brand_name: formData.brand_name || null,
        category: formData.category,
        dosage_form: formData.dosage_form,
        strength: formData.strength,
        price: parseFloat(formData.price),
        quantity_in_stock: parseInt(formData.quantity_in_stock),
        low_stock_threshold: parseInt(formData.low_stock_threshold),
        manufacturer: formData.manufacturer || null,
        description: formData.description || null,
        requires_prescription: formData.requires_prescription,
        expiry_date: formData.expiry_date || null,
        image_url: imageUrl,
      });
    } catch (error: any) {
      alert(error.message || 'Failed to update drug');
    } finally {
      setIsUploading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setImageFile(null);
      setImagePreview(drug?.image_url || null);
      setRemoveExistingImage(false);
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
    setRemoveExistingImage(false);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setRemoveExistingImage(true);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Drug</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-6 p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Drug Image */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Drug Image
                </label>
                <div className="flex items-center gap-4">
                  <label className="cursor-pointer">
                    <span className="px-4 py-2 border border-dashed border-gray-300 rounded-md text-sm text-gray-600 hover:border-primary-blue transition-colors inline-flex items-center gap-2">
                      {imagePreview ? 'Change image' : 'Upload image'}
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={handleImageChange}
                    />
                  </label>
                  {imagePreview ? (
                    <div className="relative h-16 w-16 rounded-md overflow-hidden border border-gray-200">
                      <Image
                        src={imagePreview}
                        alt="Drug preview"
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                      <button
                        type="button"
                        onClick={clearImage}
                        className="absolute -top-2 -right-2 bg-white border border-gray-200 rounded-full px-1 text-xs"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="h-16 w-16 rounded-md bg-gray-100 flex items-center justify-center text-xs text-gray-500 border border-dashed border-gray-200">
                      No image
                    </div>
                  )}
                </div>
                {uploadError && (
                  <p className="mt-2 text-xs text-red-600">{uploadError}</p>
                )}
              </div>

              {/* Drug Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Drug Name *
                </label>
                <Input
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  placeholder="Enter drug name"
                />
              </div>

              {/* Generic Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Generic Name
                </label>
                <Input
                  name="generic_name"
                  value={formData.generic_name}
                  onChange={handleChange}
                  placeholder="Enter generic name"
                />
              </div>

              {/* Brand Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Brand Name
                </label>
                <Input
                  name="brand_name"
                  value={formData.brand_name}
                  onChange={handleChange}
                  placeholder="Enter brand name"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Category *
                </label>
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-blue"
                >
                  <option value="">Select category</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              {/* Dosage Form */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Dosage Form *
                </label>
                <select
                  name="dosage_form"
                  value={formData.dosage_form}
                  onChange={handleChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-blue"
                >
                  <option value="">Select form</option>
                  {dosageForms.map((form) => (
                    <option key={form} value={form}>
                      {form.charAt(0).toUpperCase() + form.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Strength */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Strength *
                </label>
                <Input
                  name="strength"
                  value={formData.strength}
                  onChange={handleChange}
                  required
                  placeholder="e.g., 500mg"
                />
              </div>

              {/* Price */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
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
                />
              </div>

              {/* Quantity in Stock */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quantity in Stock *
                </label>
                <Input
                  name="quantity_in_stock"
                  type="number"
                  value={formData.quantity_in_stock}
                  onChange={handleChange}
                  required
                  placeholder="Enter quantity"
                />
              </div>

              {/* Low Stock Threshold */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Low Stock Threshold
                </label>
                <Input
                  name="low_stock_threshold"
                  type="number"
                  value={formData.low_stock_threshold}
                  onChange={handleChange}
                  placeholder="Default: 10"
                />
              </div>

              {/* Manufacturer */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Manufacturer
                </label>
                <Input
                  name="manufacturer"
                  value={formData.manufacturer}
                  onChange={handleChange}
                  placeholder="Enter manufacturer"
                />
              </div>

              {/* Expiry Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Expiry Date
                </label>
                <Input
                  name="expiry_date"
                  type="date"
                  value={formData.expiry_date}
                  onChange={handleChange}
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-blue"
                placeholder="Enter drug description"
              />
            </div>

            {/* Requires Prescription */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                name="requires_prescription"
                checked={formData.requires_prescription}
                onChange={handleChange}
                className="h-4 w-4 text-primary-blue border-gray-300 rounded"
              />
              <label className="text-sm font-medium text-gray-700">
                Requires Prescription
              </label>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 p-6 border-t">
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
