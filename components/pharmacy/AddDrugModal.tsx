'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

interface AddDrugModalProps {
  isOpen: boolean;
  onClose: () => void;
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

export default function AddDrugModal({
  isOpen,
  onClose,
  onSuccess,
}: AddDrugModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    generic_name: '',
    brand_name: '',
    category: '',
    dosage_form: '',
    strength: '',
    price: '',
    quantity_in_stock: '',
    low_stock_threshold: '10',
    manufacturer: '',
    description: '',
    requires_prescription: false,
    expiry_date: '',
  });

  const addDrugMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/pharmacy/drugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add drug');
      }
      return response.json();
    },
    onSuccess: () => {
      // Reset form
      setFormData({
        name: '',
        generic_name: '',
        brand_name: '',
        category: '',
        dosage_form: '',
        strength: '',
        price: '',
        quantity_in_stock: '',
        low_stock_threshold: '10',
        manufacturer: '',
        description: '',
        requires_prescription: false,
        expiry_date: '',
      });
      onSuccess();
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await addDrugMutation.mutateAsync({
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
      });
    } catch (error: any) {
      alert(error.message || 'Failed to add drug');
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Drug</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-6 p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              disabled={addDrugMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={addDrugMutation.isPending}>
              {addDrugMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Drug'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
