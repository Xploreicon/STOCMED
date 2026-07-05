'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  Barcode,
  Wifi,
  WifiOff,
  Printer,
  Share2,
  CheckCircle,
  Plus,
  Minus,
  Trash2,
  Coins,
  CreditCard,
  ArrowRight,
  TrendingUp,
  FileText,
  User,
  AlertTriangle,
  RotateCcw
} from 'lucide-react'
import { toast } from 'sonner'
import { posLocalDb, LocalInventoryItem, LocalSale, LocalSaleItem } from '@/lib/db/pos-local-db'

export default function PosPage() {
  const router = useRouter()
  const [isOnline, setIsOnline] = useState(true)
  const [syncStatus, setSyncStatus] = useState<'synced' | 'pending' | 'syncing' | 'error'>('synced')
  
  // Inventory and search states
  const [inventory, setInventory] = useState<LocalInventoryItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('All')
  
  // Cart states
  const [cart, setCart] = useState<Array<LocalSaleItem & { id: string }>>([])
  const [discount, setDiscount] = useState<number>(0)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank_transfer' | 'pharmacy_pos_terminal' | 'other'>('cash')
  
  // Session/Auth info
  const [cashier, setCashier] = useState<{ id: string; name: string } | null>(null)
  const [pharmacy, setPharmacy] = useState<{ id: string; name: string } | null>(null)
  
  // Modal states
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [lastSale, setLastSale] = useState<LocalSale | null>(null)
  const [showZReport, setShowZReport] = useState(false)
  const [zReportData, setZReportData] = useState<any>(null)
  
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Network check
  useEffect(() => {
    setIsOnline(navigator.onLine)
    const handleOnline = () => {
      setIsOnline(true)
      triggerSync()
    }
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Initial load
  useEffect(() => {
    async function init() {
      // 1. Fetch user & pharmacy profile
      try {
        const res = await fetch('/api/pharmacy/profile')
        if (res.status === 401) {
          router.push('/login')
          return
        }
        const profile = await res.json()
        if (profile.pharmacy) {
          setPharmacy({ id: profile.pharmacy.id, name: profile.pharmacy.pharmacy_name })
          setCashier({ id: profile.user.id, name: profile.user.full_name })
          
          // 2. Load inventory from IndexedDB cache
          if (posLocalDb) {
            const cached = await posLocalDb.local_inventory_cache.toArray()
            if (cached.length > 0) {
              setInventory(cached)
            }
          }
          
          // 3. Update cache if online
          if (navigator.onLine) {
            await syncInventoryCache(profile.pharmacy.id)
          }
        }
      } catch (err) {
        console.error('Error initializing POS page:', err)
        toast.error('Failed to initialize local POS cache')
      }
    }
    init()
  }, [router])

  // Sync inventory cache from backend
  const syncInventoryCache = async (pharmacyId: string) => {
    if (!posLocalDb) return
    try {
      setSyncStatus('syncing')
      const res = await fetch('/api/pharmacy/drugs')
      const data = await res.json()
      
      if (data.drugs) {
        const itemsWithBatches: LocalInventoryItem[] = []
        
        for (const drug of data.drugs) {
          // Fetch batches for each drug
          const batchRes = await fetch(`/api/pharmacy/drugs/${drug.id}/batches`)
          const batchData = await batchRes.json()
          
          itemsWithBatches.push({
            id: drug.id,
            product_id: drug.product_id,
            generic_name: drug.generic_name,
            brand_name: drug.brand_name,
            strength: drug.strength,
            dosage_form: drug.dosage_form,
            pack_size: drug.pack_size,
            price: Number(drug.price),
            quantity_in_stock: Number(drug.quantity_in_stock),
            barcode: drug.barcode,
            batches: batchData.batches || []
          })
        }
        
        // Clear and reload Dexie cache
        await posLocalDb.local_inventory_cache.clear()
        await posLocalDb.local_inventory_cache.bulkAdd(itemsWithBatches)
        setInventory(itemsWithBatches)
        setSyncStatus('synced')
      }
    } catch (err) {
      console.error('Failed caching inventory:', err)
      setSyncStatus('error')
    }
  }

  // Trigger sync of pending sales
  const triggerSync = async () => {
    if (!posLocalDb || !navigator.onLine) return
    
    try {
      const pendingSales = await posLocalDb.local_sales
        .where('sync_status')
        .equals('pending')
        .toArray()
        
      if (pendingSales.length === 0) return
      
      setSyncStatus('syncing')
      
      const res = await fetch('/api/pharmacy/pos/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sales: pendingSales })
      })
      
      const result = await res.json()
      
      if (result.success) {
        // Update synced records in local DB
        for (const id of result.syncedIds) {
          await posLocalDb.local_sales.update(id, { sync_status: 'synced', sync_error: undefined })
        }
        
        // Handle failed items if any
        for (const fail of result.failedIds) {
          await posLocalDb.local_sales.update(fail.id, { sync_status: 'error', sync_error: fail.error })
        }
        
        if (result.failedIds.length > 0) {
          setSyncStatus('error')
          toast.error(`Synced POS sales with some errors`)
        } else {
          setSyncStatus('synced')
          toast.success(`Successfully synced ${result.syncedIds.length} offline transactions!`)
          // Update cache to reflect fresh quantities
          if (pharmacy) {
            await syncInventoryCache(pharmacy.id)
          }
        }
      } else {
        setSyncStatus('error')
      }
    } catch (err) {
      console.error('Offline sync failed:', err)
      setSyncStatus('error')
    }
  }

  // Barcode / Scanner helper
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery) return
    
    // Find product matching exact barcode or generic name
    const match = inventory.find(
      (item) => item.barcode === searchQuery || item.generic_name.toLowerCase() === searchQuery.toLowerCase()
    )
    
    if (match) {
      addToCart(match)
      setSearchQuery('')
    } else {
      toast.error(`No product matches barcode/search: "${searchQuery}"`)
    }
  }

  // Simulate scanning of pre-defined barcodes
  const simulateScan = (barcode: string) => {
    setSearchQuery(barcode)
    const match = inventory.find((item) => item.barcode === barcode)
    if (match) {
      addToCart(match)
      setSearchQuery('')
      toast.success(`Scanned: ${match.brand_name || match.generic_name}`)
    } else {
      toast.error(`Barcode ${barcode} not found in inventory cache.`)
    }
  }

  // Add to cart logic
  const addToCart = (item: LocalInventoryItem) => {
    // Check stock
    const existingCartItem = cart.find((c) => c.id === item.id)
    const currentQtyInCart = existingCartItem ? existingCartItem.quantity : 0
    
    if (currentQtyInCart >= item.quantity_in_stock) {
      toast.error(`Cannot add more. Only ${item.quantity_in_stock} items in stock.`)
      return
    }

    // FEFO: Pick earliest expiring batch with stock
    const activeBatches = item.batches
      .filter((b) => Number(b.quantity_received) > 0)
      .sort((a, b) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime())
      
    if (activeBatches.length === 0) {
      toast.error('No valid active batch with stock found for this medication.')
      return
    }
    
    const selectedBatch = activeBatches[0]

    if (existingCartItem) {
      setCart(
        cart.map((c) =>
          c.id === item.id
            ? { ...c, quantity: c.quantity + 1, line_total: (c.quantity + 1) * c.unit_price }
            : c
        )
      )
    } else {
      setCart([
        ...cart,
        {
          id: item.id,
          inventory_id: item.id,
          batch_id: selectedBatch.id,
          quantity: 1,
          unit_price: item.price,
          line_total: item.price,
          generic_name: item.generic_name,
          brand_name: item.brand_name,
          strength: item.strength,
          batch_number: selectedBatch.batch_number
        }
      ])
    }
  }

  const updateCartQty = (id: string, delta: number) => {
    const cartItem = cart.find((c) => c.id === id)
    if (!cartItem) return
    
    const inventoryItem = inventory.find((i) => i.id === id)
    if (!inventoryItem) return

    const newQty = cartItem.quantity + delta
    
    if (newQty <= 0) {
      setCart(cart.filter((c) => c.id !== id))
      return
    }
    
    if (newQty > inventoryItem.quantity_in_stock) {
      toast.error(`Only ${inventoryItem.quantity_in_stock} units in stock.`)
      return
    }

    setCart(
      cart.map((c) =>
        c.id === id ? { ...c, quantity: newQty, line_total: newQty * c.unit_price } : c
      )
    )
  }

  const removeFromCart = (id: string) => {
    setCart(cart.filter((c) => c.id !== id))
  }

  // Calculations
  const subtotal = cart.reduce((sum, item) => sum + item.line_total, 0)
  const total = Math.max(0, subtotal - discount)

  // Complete checkout
  const handleCheckout = async () => {
    if (cart.length === 0) {
      toast.error('Cart is empty')
      return
    }
    if (!pharmacy || !cashier) {
      toast.error('POS session not initialized')
      return
    }

    const saleId = crypto.randomUUID()
    
    const saleRecord: LocalSale = {
      id: saleId,
      pharmacy_id: pharmacy.id,
      cashier_id: cashier.id,
      subtotal,
      discount,
      total,
      payment_method: paymentMethod,
      status: 'completed',
      created_at: new Date().toISOString(),
      items: cart,
      sync_status: 'pending'
    }

    // 1. Save to local Dexie DB
    if (posLocalDb) {
      try {
        await posLocalDb.local_sales.add(saleRecord)
        
        // Deduct quantities locally in cached inventory to prevent double selling
        for (const cartItem of cart) {
          const invItem = await posLocalDb.local_inventory_cache.get(cartItem.inventory_id)
          if (invItem) {
            const updatedQty = Math.max(0, invItem.quantity_in_stock - cartItem.quantity)
            await posLocalDb.local_inventory_cache.update(cartItem.inventory_id, {
              quantity_in_stock: updatedQty
            })
          }
        }
        
        // Re-read cache to update POS screen inventory view
        const cached = await posLocalDb.local_inventory_cache.toArray()
        setInventory(cached)

        setLastSale(saleRecord)
        setCart([])
        setDiscount(0)
        setShowReceiptModal(true)
        
        toast.success(isOnline ? 'Sale completed successfully!' : 'Sale queued offline!')
        
        // 2. Trigger sync immediately in background if online
        if (isOnline) {
          triggerSync()
        } else {
          setSyncStatus('pending')
        }
      } catch (err) {
        console.error('Local save error:', err)
        toast.error('Failed to log transaction locally')
      }
    }
  }

  // Filter products catalog
  const filteredProducts = inventory.filter((item) => {
    const matchesSearch =
      item.generic_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.brand_name && item.brand_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.barcode && item.barcode.includes(searchQuery))
      
    if (selectedCategory === 'All') return matchesSearch
    
    // Controlled mapping of categories
    return matchesSearch
  })

  // Z-Report calculations
  const generateZReport = async () => {
    if (!posLocalDb) return
    const allSales = await posLocalDb.local_sales.toArray()
    
    // Group totals by payment method
    const totals = {
      cash: 0,
      bank_transfer: 0,
      pharmacy_pos_terminal: 0,
      other: 0,
      grandTotal: 0,
      count: 0
    }

    allSales.forEach((sale) => {
      totals[sale.payment_method] += Number(sale.total)
      totals.grandTotal += Number(sale.total)
      totals.count += 1
    })

    setZReportData(totals)
    setShowZReport(true)
  }

  return (
    <div className="min-h-screen bg-[#0A2540] text-white flex flex-col font-sans pb-16 lg:pb-0">
      {/* POS Header */}
      <header className="bg-[#0D3460] border-b border-white/10 px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary p-2 rounded-lg text-white font-bold text-lg tracking-wider">SM</div>
          <div>
            <h1 className="font-semibold text-lg text-white">StocMed POS</h1>
            <p className="text-xs text-white/60">{pharmacy?.name || 'Loading pharmacy...'}</p>
          </div>
        </div>

        {/* Sync & Connectivity panel */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#164177] border border-white/10 text-xs">
            {isOnline ? (
              <span className="flex items-center gap-1 text-[#34D399]">
                <Wifi className="h-4 w-4" /> Online
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[#FB7185]">
                <WifiOff className="h-4 w-4" /> Offline Mode
              </span>
            )}
          </div>

          <div className="text-xs">
            {syncStatus === 'synced' && (
              <span className="text-[#34D399] font-semibold px-2 py-1 bg-success/10 border border-success/20 rounded">
                Synced
              </span>
            )}
            {syncStatus === 'pending' && (
              <span className="text-[#FBBF24] font-semibold px-2 py-1 bg-warning/10 border border-warning/20 rounded">
                Pending Sync
              </span>
            )}
            {syncStatus === 'syncing' && (
              <span className="text-[#54B7FF] font-semibold px-2 py-1 bg-primary/10 border border-primary/20 rounded animate-pulse">
                Syncing...
              </span>
            )}
            {syncStatus === 'error' && (
              <span className="text-[#FB7185] font-semibold px-2 py-1 bg-danger/10 border border-danger/20 rounded">
                Sync Error
              </span>
            )}
          </div>

          <button
            onClick={generateZReport}
            className="px-3 py-1.5 bg-[#164177] hover:bg-white/5 rounded text-white/80 text-xs flex items-center gap-1.5 border border-white/10 transition"
          >
            <FileText className="h-3.5 w-3.5" /> Daily Z-Report
          </button>

          <div className="text-white/60 text-xs hidden md:flex items-center gap-1">
            <User className="h-4 w-4 text-white/40" />
            <span>{cashier?.name || 'Cashier'}</span>
          </div>
        </div>
      </header>

      {/* POS Workspace */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 overflow-hidden">
        {/* Left Side: Product catalog & fast select */}
        <div className="lg:col-span-2 p-6 flex flex-col gap-4 overflow-y-auto border-r border-white/10">

          {/* Barcode Search bar */}
          <form onSubmit={handleBarcodeSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 h-5 w-5" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search medication name, strength or scan barcode..."
                className="w-full bg-[#0D3460] border border-white/10 text-white pl-12 pr-4 py-3 rounded-lg focus:outline-none focus:border-primary transition"
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="bg-[#164177] hover:bg-white/5 px-4 rounded-lg flex items-center gap-1.5 border border-white/10 text-sm font-semibold transition"
            >
              <Barcode className="h-5 w-5 text-white/60" /> Find
            </button>
          </form>

          {/* Quick Barcode Simulator row */}
          <div className="bg-[#0D3460]/60 p-3 rounded-lg border border-[#0D3460] flex items-center justify-between gap-4 flex-wrap text-xs">
            <span className="text-white/60 flex items-center gap-1 font-semibold">
              <Barcode className="h-4 w-4" /> Scanner Simulator:
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => simulateScan('61500000001')}
                className="px-2.5 py-1 bg-[#164177] hover:bg-white/5 rounded text-white/60 border border-white/10 transition"
              >
                Paracetamol (61500000001)
              </button>
              <button
                onClick={() => simulateScan('61500000031')}
                className="px-2.5 py-1 bg-[#164177] hover:bg-white/5 rounded text-white/60 border border-white/10 transition"
              >
                Coartem (61500000031)
              </button>
            </div>
          </div>

          {/* Quick-tap popular medications list */}
          <div>
            <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">Popular Items</h3>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {inventory.slice(0, 5).map((item) => (
                <button
                  key={item.id}
                  onClick={() => addToCart(item)}
                  disabled={item.quantity_in_stock === 0}
                  className="flex-shrink-0 bg-[#0D3460] hover:bg-[#164177] border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 rounded-lg text-left transition flex flex-col gap-0.5"
                >
                  <span className="font-semibold text-white/80 text-sm">
                    {item.brand_name || item.generic_name}
                  </span>
                  <span className="text-xs text-white/60">
                    {item.strength} • ₦{item.price}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Catalog grid */}
          <div className="flex-1">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider">Catalog Matches</h3>
              <span className="text-xs text-white/40">{filteredProducts.length} items found</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredProducts.map((item) => {
                const isOutOfStock = item.quantity_in_stock === 0
                const isLowStock = item.quantity_in_stock > 0 && item.quantity_in_stock <= 10
                
                return (
                  <div
                    key={item.id}
                    onClick={() => !isOutOfStock && addToCart(item)}
                    className={`bg-[#0D3460] border rounded-xl p-4 flex flex-col justify-between gap-3 cursor-pointer transition ${
                      isOutOfStock
                        ? 'border-white/10 opacity-55 cursor-not-allowed'
                        : 'border-white/10 hover:border-primary/80 hover:bg-white/5 shadow-md'
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-start gap-1">
                        <h4 className="font-semibold text-white text-sm line-clamp-1">
                          {item.brand_name || item.generic_name}
                        </h4>
                        <span className="text-xs bg-[#164177] text-white/60 px-2 py-0.5 rounded capitalize">
                          {item.dosage_form}
                        </span>
                      </div>
                      {item.brand_name && (
                        <p className="text-xs text-white/60 mt-0.5 line-clamp-1">{item.generic_name}</p>
                      )}
                      <p className="text-xs text-white/40 mt-1">Strength: {item.strength}</p>
                    </div>

                    <div className="flex justify-between items-end border-t border-white/10 pt-3">
                      <div>
                        <span className="text-xs text-white/40">Unit Price</span>
                        <p className="font-bold text-base text-[#54B7FF]">₦{item.price.toLocaleString()}</p>
                      </div>

                      <div className="text-right">
                        {isOutOfStock ? (
                          <span className="text-[10px] font-bold bg-danger/10 text-[#FB7185] px-2 py-0.5 rounded border border-danger/20">
                            Out of stock
                          </span>
                        ) : isLowStock ? (
                          <span className="text-[10px] font-bold bg-warning/10 text-[#FBBF24] px-2 py-0.5 rounded border border-warning/20">
                            {item.quantity_in_stock} left
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold bg-success/10 text-[#34D399] px-2 py-0.5 rounded border border-success/20">
                            {item.quantity_in_stock} units
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Right Side: Active checkout cart */}
        <div className="bg-[#0D3460] flex flex-col justify-between overflow-y-auto">
          {/* Cart Header */}
          <div className="p-4 border-b border-white/10 flex justify-between items-center">
            <h2 className="font-semibold text-white flex items-center gap-2">
              Current Basket <span className="bg-primary text-white text-xs px-2 py-0.5 rounded-full">{cart.length}</span>
            </h2>
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="text-xs text-white/60 hover:text-[#FB7185] transition"
              >
                Clear Cart
              </button>
            )}
          </div>

          {/* Cart item list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-white/40 py-12 gap-3">
                <Barcode className="h-10 w-10 text-white/20" />
                <div>
                  <p className="text-sm font-semibold">Your basket is empty</p>
                  <p className="text-xs text-white/20 mt-1">Scan a barcode or select from the catalog</p>
                </div>
              </div>
            ) : (
              cart.map((item) => (
                <div key={item.id} className="bg-[#0A2540] p-3 rounded-lg border border-white/10 flex flex-col gap-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-semibold text-xs text-white">
                        {item.brand_name || item.generic_name}
                      </h4>
                      <p className="text-[10px] text-white/40 mt-0.5">
                        {item.strength} • Batch: {item.batch_number}
                      </p>
                    </div>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-white/40 hover:text-[#FB7185] transition p-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex justify-between items-center border-t border-white/10 pt-2">
                    <div className="flex items-center bg-[#0D3460] border border-white/10 rounded">
                      <button
                        onClick={() => updateCartQty(item.id, -1)}
                        className="px-2 py-1 text-white/60 hover:text-white transition"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="px-3 text-xs font-semibold text-white/80">{item.quantity}</span>
                      <button
                        onClick={() => updateCartQty(item.id, 1)}
                        className="px-2 py-1 text-white/60 hover:text-white transition"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <span className="font-semibold text-sm text-white/80">
                      ₦{(item.quantity * item.unit_price).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Payment panel */}
          <div className="p-4 border-t border-white/10 bg-[#0A2540]/80">
            {/* Calculation summary */}
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-xs text-white/60">
                <span>Subtotal</span>
                <span>₦{subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-white/60">
                <span>Discount (₦)</span>
                <input
                  type="number"
                  value={discount === 0 ? '' : discount}
                  onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))}
                  placeholder="0.00"
                  className="w-24 bg-[#0D3460] border border-white/10 rounded px-2 py-1 text-right text-white text-xs focus:outline-none focus:border-primary"
                />
              </div>
              <div className="flex justify-between text-sm font-semibold text-white border-t border-white/10 pt-2">
                <span>Grand Total</span>
                <span className="text-lg text-[#34D399]">₦{total.toLocaleString()}</span>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div className="mb-4">
              <span className="text-xs font-semibold text-white/60 uppercase tracking-wider block mb-2">Payment Method</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={`py-2 px-3 rounded-lg border text-xs font-medium transition flex items-center justify-center gap-1.5 ${
                    paymentMethod === 'cash'
                      ? 'bg-primary/20 border-primary text-[#54B7FF]'
                      : 'bg-[#0D3460] border-white/10 text-white/60 hover:bg-[#164177]'
                  }`}
                >
                  <Coins className="h-4 w-4" /> Cash
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('bank_transfer')}
                  className={`py-2 px-3 rounded-lg border text-xs font-medium transition flex items-center justify-center gap-1.5 ${
                    paymentMethod === 'bank_transfer'
                      ? 'bg-primary/20 border-primary text-[#54B7FF]'
                      : 'bg-[#0D3460] border-white/10 text-white/60 hover:bg-[#164177]'
                  }`}
                >
                  <RotateCcw className="h-4 w-4" /> Bank Transfer
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('pharmacy_pos_terminal')}
                  className={`py-2 px-3 rounded-lg border text-xs font-medium transition flex items-center justify-center gap-1.5 ${
                    paymentMethod === 'pharmacy_pos_terminal'
                      ? 'bg-primary/20 border-primary text-[#54B7FF]'
                      : 'bg-[#0D3460] border-white/10 text-white/60 hover:bg-[#164177]'
                  }`}
                >
                  <CreditCard className="h-4 w-4" /> POS Terminal
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('other')}
                  className={`py-2 px-3 rounded-lg border text-xs font-medium transition flex items-center justify-center gap-1.5 ${
                    paymentMethod === 'other'
                      ? 'bg-primary/20 border-primary text-[#54B7FF]'
                      : 'bg-[#0D3460] border-white/10 text-white/60 hover:bg-[#164177]'
                  }`}
                >
                  Other Method
                </button>
              </div>
            </div>

            {/* Check out button */}
            <button
              onClick={handleCheckout}
              disabled={cart.length === 0}
              className="w-full bg-success hover:bg-success/80 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition"
            >
              {isOnline ? 'Complete Checkout' : 'Save Checkout (Offline)'} <ArrowRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* RECEIPT MODAL */}
      {showReceiptModal && lastSale && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0D3460] rounded-2xl max-w-sm w-full p-6 border border-white/10 flex flex-col gap-6 shadow-2xl">
            <div className="flex flex-col items-center justify-center text-center gap-2 border-b border-white/10 pb-4">
              <CheckCircle className="h-12 w-12 text-success" />
              <h2 className="font-bold text-lg text-white">Transaction Logged!</h2>
              <p className="text-xs text-white/60">
                {isOnline ? 'Synced to Supabase Cloud' : 'Queued in Local Storage'}
              </p>
            </div>

            {/* MONOSPACE THERMAL RECEIPT DISPLAY */}
            <div className="bg-white text-[#0A2540] font-mono text-[10px] p-4 rounded-lg shadow border border-gray-200">
              <div className="text-center font-bold uppercase tracking-wider text-xs mb-2">STOCMED PHARMACY RECEIPT</div>
              <div className="text-center mb-4">{pharmacy?.name}</div>

              <div className="border-t border-dashed border-gray-400 py-2 space-y-1">
                <div>DATE: {new Date(lastSale.created_at).toLocaleString()}</div>
                <div>SALE ID: {lastSale.id.substring(0, 8)}...</div>
                <div>CASHIER: {cashier?.name}</div>
              </div>

              <div className="border-t border-b border-dashed border-gray-400 py-2 my-2">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-200 font-bold">
                      <th className="py-1">Med</th>
                      <th className="py-1 text-center">Qty</th>
                      <th className="py-1 text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lastSale.items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="py-1">
                          {item.brand_name || item.generic_name} ({item.strength})
                          <div className="text-[8px] text-gray-500">Batch: {item.batch_number}</div>
                        </td>
                        <td className="py-1 text-center">{item.quantity}</td>
                        <td className="py-1 text-right">₦{(item.quantity * item.unit_price).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-1 text-right">
                <div>SUBTOTAL: ₦{lastSale.subtotal.toLocaleString()}</div>
                {lastSale.discount > 0 && <div>DISCOUNT: -₦{lastSale.discount.toLocaleString()}</div>}
                <div className="font-bold text-xs">TOTAL: ₦{lastSale.total.toLocaleString()}</div>
              </div>

              <div className="border-t border-dashed border-gray-400 mt-3 pt-2 text-center uppercase font-bold">
                PAYMENT METHOD: {lastSale.payment_method.replace('_', ' ')}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  toast.success('Simulating receipt print via Bluetooth thermal printer...')
                }}
                className="flex-1 py-2 px-3 bg-[#164177] hover:bg-white/5 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border border-white/10 transition"
              >
                <Printer className="h-4 w-4" /> Print Receipt
              </button>
              <button
                onClick={() => {
                  toast.success('Simulated receipt SMS/WhatsApp sharing copy link!')
                }}
                className="py-2 px-3 bg-[#164177] hover:bg-white/5 text-white rounded-lg text-xs font-semibold flex items-center justify-center transition border border-white/10"
                aria-label="Share receipt"
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>

            <button
              onClick={() => setShowReceiptModal(false)}
              className="w-full bg-primary hover:bg-primary/80 text-white py-2.5 rounded-lg font-bold text-sm transition"
            >
              Start New Sale
            </button>
          </div>
        </div>
      )}

      {/* DAILY Z-REPORT MODAL */}
      {showZReport && zReportData && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0D3460] rounded-2xl max-w-sm w-full p-6 border border-white/10 flex flex-col gap-5 shadow-2xl">
            <div className="border-b border-white/10 pb-3 flex justify-between items-center">
              <h2 className="font-bold text-lg text-white flex items-center gap-2">
                <FileText className="h-5 w-5 text-[#54B7FF]" /> Shift Z-Report
              </h2>
              <button
                onClick={() => setShowZReport(false)}
                className="text-white/60 hover:text-white text-sm"
              >
                Close
              </button>
            </div>

            <div className="space-y-4">
              <div className="bg-[#0A2540] p-4 rounded-xl border border-white/10">
                <span className="text-xs text-white/40 uppercase tracking-wider font-semibold">Total Revenue</span>
                <p className="text-3xl font-extrabold text-[#34D399] mt-1">₦{zReportData.grandTotal.toLocaleString()}</p>
                <p className="text-xs text-white/60 mt-1">From {zReportData.count} transactions today</p>
              </div>

              <div className="space-y-2">
                <span className="text-xs text-white/60 font-semibold uppercase tracking-wider block">Method Breakdown</span>

                <div className="flex justify-between items-center text-xs py-2 border-b border-white/10">
                  <span className="text-white/60 flex items-center gap-1.5"><Coins className="h-3.5 w-3.5" /> Cash</span>
                  <span className="font-semibold text-white/80">₦{zReportData.cash.toLocaleString()}</span>
                </div>

                <div className="flex justify-between items-center text-xs py-2 border-b border-white/10">
                  <span className="text-white/60 flex items-center gap-1.5"><RotateCcw className="h-3.5 w-3.5" /> Bank Transfer</span>
                  <span className="font-semibold text-white/80">₦{zReportData.bank_transfer.toLocaleString()}</span>
                </div>

                <div className="flex justify-between items-center text-xs py-2 border-b border-white/10">
                  <span className="text-white/60 flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5" /> POS Terminals</span>
                  <span className="font-semibold text-white/80">₦{zReportData.pharmacy_pos_terminal.toLocaleString()}</span>
                </div>

                <div className="flex justify-between items-center text-xs py-2">
                  <span className="text-white/60">Other Methods</span>
                  <span className="font-semibold text-white/80">₦{zReportData.other.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-2 border-t border-white/10 pt-4 mt-2">
              <button
                onClick={() => {
                  toast.success('Shift Z-report summary printed!')
                }}
                className="flex-1 py-2 px-3 bg-[#164177] hover:bg-white/5 text-white border border-white/10 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition"
              >
                <Printer className="h-4 w-4" /> Print Z-Report
              </button>
              <button
                onClick={() => setShowZReport(false)}
                className="flex-1 py-2.5 bg-primary hover:bg-primary/80 text-white rounded-lg text-xs font-bold transition"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
