import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"

interface AddDrugModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

interface DrugFormData {
  drugName: string
  genericName: string
  brandName: string
  category: string
  dosageForm: string
  strength: string
  price: string
  quantity: string
  expiryDate: string
  featured: boolean
}

const categories = [
  "Analgesics",
  "Antibiotics",
  "Antimalarials",
  "Antihypertensives",
  "Diabetes",
  "Vitamins",
  "Gastrointestinal",
  "Respiratory",
  "Others",
]

const dosageForms = [
  "Tablet",
  "Capsule",
  "Syrup",
  "Injection",
  "Cream",
  "Drops",
  "Inhaler",
]

export const AddDrugModal: React.FC<AddDrugModalProps> = ({
  open,
  onOpenChange,
  onSuccess,
}) => {
  const [loading, setLoading] = React.useState(false)
  const [formData, setFormData] = React.useState<DrugFormData>({
    drugName: "",
    genericName: "",
    brandName: "",
    category: "",
    dosageForm: "",
    strength: "",
    price: "",
    quantity: "",
    expiryDate: "",
    featured: false,
  })

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleCheckboxChange = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, featured: checked }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate required fields
    if (
      !formData.drugName ||
      !formData.category ||
      !formData.dosageForm ||
      !formData.strength ||
      !formData.price ||
      !formData.quantity
    ) {
      alert("Please fill in all required fields")
      return
    }

    setLoading(true)

    try {
      // TODO: Add API call to save drug
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Show success message
      alert("Drug added to inventory successfully!")

      // Reset form
      setFormData({
        drugName: "",
        genericName: "",
        brandName: "",
        category: "",
        dosageForm: "",
        strength: "",
        price: "",
        quantity: "",
        expiryDate: "",
        featured: false,
      })

      // Close modal and trigger success callback
      onOpenChange(false)
      onSuccess?.()
    } catch (error) {
      console.error("Error adding drug:", error)
      alert("Failed to add drug. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl"
        onClose={() => onOpenChange(false)}
      >
        <DialogHeader>
          <DialogTitle>Add New Drug</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Drug Name */}
              <div className="space-y-2">
                <Label htmlFor="drugName">
                  Drug Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="drugName"
                  name="drugName"
                  value={formData.drugName}
                  onChange={handleChange}
                  placeholder="Enter drug name"
                  required
                />
              </div>

              {/* Generic Name */}
              <div className="space-y-2">
                <Label htmlFor="genericName">Generic Name</Label>
                <Input
                  id="genericName"
                  name="genericName"
                  value={formData.genericName}
                  onChange={handleChange}
                  placeholder="Enter generic name"
                />
              </div>

              {/* Brand Name */}
              <div className="space-y-2">
                <Label htmlFor="brandName">Brand Name</Label>
                <Input
                  id="brandName"
                  name="brandName"
                  value={formData.brandName}
                  onChange={handleChange}
                  placeholder="Enter brand name"
                />
              </div>

              {/* Category */}
              <div className="space-y-2">
                <Label htmlFor="category">
                  Category <span className="text-red-500">*</span>
                </Label>
                <Select
                  id="category"
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  required
                >
                  <option value="">Select category</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Dosage Form */}
              <div className="space-y-2">
                <Label htmlFor="dosageForm">
                  Dosage Form <span className="text-red-500">*</span>
                </Label>
                <Select
                  id="dosageForm"
                  name="dosageForm"
                  value={formData.dosageForm}
                  onChange={handleChange}
                  required
                >
                  <option value="">Select dosage form</option>
                  {dosageForms.map((form) => (
                    <option key={form} value={form}>
                      {form}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Strength */}
              <div className="space-y-2">
                <Label htmlFor="strength">
                  Strength <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="strength"
                  name="strength"
                  value={formData.strength}
                  onChange={handleChange}
                  placeholder="e.g., 500mg"
                  required
                />
              </div>

              {/* Price */}
              <div className="space-y-2">
                <Label htmlFor="price">
                  Price ₦ <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="price"
                  name="price"
                  type="number"
                  value={formData.price}
                  onChange={handleChange}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  required
                />
              </div>

              {/* Quantity in Stock */}
              <div className="space-y-2">
                <Label htmlFor="quantity">
                  Quantity in Stock <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="quantity"
                  name="quantity"
                  type="number"
                  value={formData.quantity}
                  onChange={handleChange}
                  placeholder="0"
                  min="0"
                  required
                />
              </div>

              {/* Expiry Date */}
              <div className="space-y-2">
                <Label htmlFor="expiryDate">Expiry Date</Label>
                <Input
                  id="expiryDate"
                  name="expiryDate"
                  type="date"
                  value={formData.expiryDate}
                  onChange={handleChange}
                />
              </div>

              {/* Featured Checkbox */}
              <div className="space-y-2 flex items-end pb-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="featured"
                    checked={formData.featured}
                    onCheckedChange={handleCheckboxChange}
                  />
                  <Label htmlFor="featured" className="cursor-pointer">
                    Featured
                  </Label>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Adding..." : "Add to Inventory"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
