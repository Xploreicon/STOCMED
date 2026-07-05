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
import { Loader2, Search, Plus, ArrowLeft, Check, AlertCircle, Camera, X } from 'lucide-react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

interface AddDrugModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  preselectedProduct?: any | null;
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
  'Tablet',
  'Capsule',
  'Syrup',
  'Injection',
  'Cream',
  'Drops',
  'Inhaler',
];

export default function AddDrugModal({
  isOpen,
  onClose,
  onSuccess,
  preselectedProduct = null,
}: AddDrugModalProps) {
  const queryClient = useQueryClient();

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);

  // Mode state
  const [isCreatingNewProduct, setIsCreatingNewProduct] = useState(false);

  // Form states
  const [stockForm, setStockForm] = useState({
    price: '',
    quantity_in_stock: '',
    low_stock_threshold: '10',
    batch_number: '',
    expiry_date: '',
  });

  const [newProductForm, setNewProductForm] = useState({
    generic_name: '',
    brand_name: '',
    strength: '',
    dosage_form: '',
    category: '',
    pack_size: '',
    manufacturer: '',
  });

  const [formError, setFormError] = useState<string | null>(null);

  // Image Upload State
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Debounced search effect
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const delayDebounce = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/pharmacy/products/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data);
        }
      } catch (err) {
        console.error('Error searching products:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  // Reset state on open/close
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSearchResults([]);
      setSelectedProduct(preselectedProduct);
      setIsCreatingNewProduct(false);
      setFormError(null);
      setStockForm({
        price: '',
        quantity_in_stock: '',
        low_stock_threshold: '10',
        batch_number: '',
        expiry_date: '',
      });
      setNewProductForm({
        generic_name: '',
        brand_name: '',
        strength: '',
        dosage_form: '',
        category: '',
        pack_size: '',
        manufacturer: '',
      });
      setImageFile(null);
      setImagePreview(null);
      setUploadError(null);
      setIsUploading(false);
    }
  }, [isOpen, preselectedProduct]);

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setImageFile(null);
      setImagePreview(null);
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

  const addInventoryMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/pharmacy/drugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add drug to inventory');
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

  const createProductMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/pharmacy/products/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create product in catalogue');
      }
      return response.json();
    },
    onSuccess: (newProduct) => {
      setSelectedProduct(newProduct);
      setIsCreatingNewProduct(false);
    },
  });

  const handleStockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;

    setFormError(null);
    try {
      await addInventoryMutation.mutateAsync({
        product_id: selectedProduct.id,
        price: parseFloat(stockForm.price),
        quantity_in_stock: parseInt(stockForm.quantity_in_stock),
        low_stock_threshold: parseInt(stockForm.low_stock_threshold),
        batch_number: stockForm.batch_number,
        expiry_date: stockForm.expiry_date,
      });
    } catch (err: any) {
      setFormError(err.message || 'An error occurred while adding to inventory.');
    }
  };

  const handleCreateProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      let imageUrl: string | null = null;

      if (imageFile) {
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

      await createProductMutation.mutateAsync({
        generic_name: newProductForm.generic_name,
        brand_name: newProductForm.brand_name || null,
        strength: newProductForm.strength,
        dosage_form: newProductForm.dosage_form,
        category: newProductForm.category,
        pack_size: newProductForm.pack_size || null,
        manufacturer: newProductForm.manufacturer || null,
        image_url: imageUrl,
      });
    } catch (err: any) {
      setFormError(err.message || 'An error occurred while creating product.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleStockChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setStockForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleProductChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setNewProductForm((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 border border-border rounded-xl shadow-2xl">
        <DialogHeader className="p-6 border-b bg-surface/50">
          <DialogTitle className="text-xl font-semibold text-ink">
            {isCreatingNewProduct
              ? 'Add New Catalogue Product'
              : selectedProduct
              ? 'Enter Stock details'
              : 'Search Product Catalogue'}
          </DialogTitle>
        </DialogHeader>

        {formError && (
          <div className="mx-6 mt-4 p-3 bg-danger/5 border border-danger/20 text-danger rounded-md flex items-start gap-2 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        {/* STEP 1: Search and Select */}
        {!selectedProduct && !isCreatingNewProduct && (
          <div className="p-6 space-y-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-ink-light" />
              <Input
                placeholder="Type generic name, brand name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-12 text-base border-border focus:ring-2 focus:ring-primary rounded-lg"
                autoFocus
              />
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-ink-light uppercase tracking-wider">
                Catalogue Search Results
              </h3>

              {isSearching ? (
                <div className="py-12 flex items-center justify-center gap-2 text-ink-muted">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Searching catalogue...</span>
                </div>
              ) : searchResults.length > 0 ? (
                <div className="divide-y divide-border max-h-[300px] overflow-y-auto border border-border rounded-lg bg-white shadow-inner">
                  {searchResults.map((prod) => (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => setSelectedProduct(prod)}
                      className="w-full text-left p-4 hover:bg-surface transition-colors flex items-center justify-between"
                    >
                      <div>
                        <div className="font-semibold text-ink">
                          {prod.brand_name ? `${prod.brand_name} (${prod.generic_name})` : prod.generic_name}
                        </div>
                        <div className="text-xs text-ink-muted mt-1">
                          Strength: <span className="font-medium text-ink-muted">{prod.strength}</span> | Form: <span className="font-medium text-ink-muted">{prod.dosage_form}</span> | Category: <span className="font-medium text-ink-muted">{prod.category}</span>
                        </div>
                      </div>
                      <Plus className="w-5 h-5 text-ink-light" />
                    </button>
                  ))}
                </div>
              ) : searchQuery.trim() ? (
                <div className="py-8 text-center text-ink-muted">
                  No matches found for &quot;{searchQuery}&quot;.
                </div>
              ) : (
                <div className="py-12 text-center text-ink-light text-sm">
                  Search above to pull from our 300+ canonical drug catalogue.
                </div>
              )}
            </div>

            <div className="border-t pt-4 flex items-center justify-between">
              <span className="text-sm text-ink-muted">Can&apos;t find your drug in the catalogue?</span>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreatingNewProduct(true)}
                className="hover:bg-surface border-dashed text-primary hover:text-primary/80"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add New Product
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: Create new Product Catalogue Item */}
        {isCreatingNewProduct && (
          <form onSubmit={handleCreateProductSubmit} className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Product Image */}
              <div className="md:col-span-2 flex flex-col items-center justify-center p-4 border border-dashed border-border rounded-lg bg-surface/30">
                <label className="block text-sm font-medium text-ink-muted mb-2 text-center w-full">
                  Product Image (optional)
                </label>
                <div className="flex flex-col items-center gap-3">
                  {imagePreview ? (
                    <div className="relative h-28 w-28 rounded-xl overflow-hidden border border-border shadow-md group bg-white">
                      <Image
                        src={imagePreview}
                        alt="Product preview"
                        fill
                        sizes="112px"
                        className="object-cover"
                      />
                      <button
                        type="button"
                        onClick={clearImage}
                        className="absolute top-1 right-1 bg-white/90 hover:bg-white text-ink rounded-full p-1 border border-border shadow transition-transform hover:scale-110"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="cursor-pointer flex flex-col items-center justify-center h-28 w-28 rounded-xl border border-dashed border-border hover:border-primary/50 hover:bg-surface/50 bg-white transition-all shadow-sm">
                      <Camera className="w-8 h-8 text-ink-light mb-1.5" />
                      <span className="text-[10px] font-medium text-ink-muted">Upload Image</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        className="hidden"
                        onChange={handleImageChange}
                      />
                    </label>
                  )}
                  {uploadError && (
                    <p className="text-xs text-danger font-medium mt-1">{uploadError}</p>
                  )}
                  <p className="text-[10px] text-ink-muted">
                    Supports JPG, PNG (Max 1MB)
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1.5">
                  Generic Name *
                </label>
                <Input
                  name="generic_name"
                  value={newProductForm.generic_name}
                  onChange={handleProductChange}
                  required
                  placeholder="e.g. Paracetamol"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1.5">
                  Brand Name (Optional)
                </label>
                <Input
                  name="brand_name"
                  value={newProductForm.brand_name}
                  onChange={handleProductChange}
                  placeholder="e.g. Panadol"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1.5">
                  Strength *
                </label>
                <Input
                  name="strength"
                  value={newProductForm.strength}
                  onChange={handleProductChange}
                  required
                  placeholder="e.g. 500mg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1.5">
                  Dosage Form *
                </label>
                <select
                  name="dosage_form"
                  value={newProductForm.dosage_form}
                  onChange={handleProductChange}
                  required
                  className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm h-10 bg-white"
                >
                  <option value="">Select form</option>
                  {dosageForms.map((form) => (
                    <option key={form} value={form}>
                      {form}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1.5">
                  Category *
                </label>
                <select
                  name="category"
                  value={newProductForm.category}
                  onChange={handleProductChange}
                  required
                  className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm h-10 bg-white"
                >
                  <option value="">Select category</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1.5">
                  Pack Size (Optional)
                </label>
                <Input
                  name="pack_size"
                  value={newProductForm.pack_size}
                  onChange={handleProductChange}
                  placeholder="e.g. 10x10, 100s"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-ink-muted mb-1.5">
                  Manufacturer (Optional)
                </label>
                <Input
                  name="manufacturer"
                  value={newProductForm.manufacturer}
                  onChange={handleProductChange}
                  placeholder="e.g. Emzor Pharmaceuticals"
                />
              </div>
            </div>

            <div className="flex justify-between items-center border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsCreatingNewProduct(false)}
                className="text-ink-muted hover:text-ink-muted"
                disabled={createProductMutation.isPending || isUploading}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to search
              </Button>
              <Button type="submit" disabled={createProductMutation.isPending || isUploading}>
                {createProductMutation.isPending || isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {isUploading ? 'Uploading...' : 'Creating...'}
                  </>
                ) : (
                  'Create & Select'
                )}
              </Button>
            </div>
          </form>
        )}

        {/* STEP 3: Enter Stock details */}
        {selectedProduct && (
          <form onSubmit={handleStockSubmit} className="p-6 space-y-6">
            {/* Display Locked Product Attributes */}
            <div className="bg-surface border border-border rounded-lg p-4 flex items-center gap-4">
              {selectedProduct.image_url ? (
                <div className="relative h-16 w-16 rounded-lg overflow-hidden border border-border bg-white shrink-0">
                  <Image
                    src={selectedProduct.image_url}
                    alt={selectedProduct.brand_name || selectedProduct.generic_name}
                    fill
                    sizes="64px"
                    className="object-cover"
                    unoptimized
                  />
                </div>
              ) : (
                <div className="h-16 w-16 rounded-lg bg-white border border-dashed border-border flex items-center justify-center text-xs text-ink-light shrink-0">
                  No image
                </div>
              )}
              <div className="flex-1">
                <h4 className="text-xs font-semibold text-ink-light uppercase tracking-wider">
                  Selected Product
                </h4>
                <div className="font-semibold text-ink mt-1">
                  {selectedProduct.brand_name ? `${selectedProduct.brand_name} (${selectedProduct.generic_name})` : selectedProduct.generic_name}
                </div>
                <div className="text-xs text-ink-muted mt-1">
                  {selectedProduct.strength} • {selectedProduct.dosage_form} • {selectedProduct.category}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSelectedProduct(null)}
                className="text-xs text-primary hover:text-primary/80 hover:bg-surface self-start shrink-0"
              >
                Change Product
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1.5">
                  Price (₦) *
                </label>
                <Input
                  name="price"
                  type="number"
                  step="0.01"
                  value={stockForm.price}
                  onChange={handleStockChange}
                  required
                  placeholder="e.g. 1500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1.5">
                  Opening Stock Quantity *
                </label>
                <Input
                  name="quantity_in_stock"
                  type="number"
                  value={stockForm.quantity_in_stock}
                  onChange={handleStockChange}
                  required
                  placeholder="e.g. 100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1.5">
                  Batch Number *
                </label>
                <Input
                  name="batch_number"
                  value={stockForm.batch_number}
                  onChange={handleStockChange}
                  required
                  placeholder="e.g. B-1029"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1.5">
                  Expiry Date *
                </label>
                <Input
                  name="expiry_date"
                  type="date"
                  value={stockForm.expiry_date}
                  onChange={handleStockChange}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1.5">
                  Low Stock Threshold
                </label>
                <Input
                  name="low_stock_threshold"
                  type="number"
                  value={stockForm.low_stock_threshold}
                  onChange={handleStockChange}
                  placeholder="Default: 10"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={addInventoryMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={addInventoryMutation.isPending}>
                {addInventoryMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  'Add to Inventory'
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
