'use client'

import { Button } from '@/components/ui/button'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, User, Banknote, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { posLocalDb, LocalInventoryItem, LocalSale, LocalSaleItem, HeldSale, LocalShift } from '@/lib/db/pos-local-db'
import { allocateFEFO, formatExpShort } from '@/lib/pos/fefo'
import { syncPendingSales, forceRetryAll } from '@/lib/pos/sync-engine'
import CartPanel from '@/components/pos/CartPanel'
import CheckoutPanel from '@/components/pos/CheckoutPanel'
import ReceiptModal from '@/components/pos/ReceiptModal'
import SyncPill from '@/components/pos/SyncPill'

type CartItem = LocalSaleItem & { id: string }
type PaymentMethod = 'cash' | 'bank_transfer' | 'pharmacy_pos_terminal' | 'other'

export default function PosPage() {
  const router = useRouter()
  const [isOnline, setIsOnline] = useState(true)
  const [syncStatus, setSyncStatus] = useState<'synced'|'pending'|'syncing'|'error'>('synced')
  const [pendingCount, setPendingCount] = useState(0)
  const [inventory, setInventory] = useState<LocalInventoryItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [discount, setDiscount] = useState(0)
  const [cashier, setCashier] = useState<{id:string;name:string}|null>(null)
  const [pharmacy, setPharmacy] = useState<{id:string;name:string}|null>(null)
  const [showReceipt, setShowReceipt] = useState(false)
  const [lastSale, setLastSale] = useState<LocalSale|null>(null)
  const [heldSales, setHeldSales] = useState<HeldSale[]>([])
  const [showHeldList, setShowHeldList] = useState(false)
  const [currentShift, setCurrentShift] = useState<LocalShift | null>(null)
  const [popularItems, setPopularItems] = useState<LocalInventoryItem[]>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const syncIntervalRef = useRef<NodeJS.Timeout|null>(null)

  // Keep search focused
  useEffect(() => { searchRef.current?.focus() }, [cart.length, showReceipt])

  // Online/offline
  useEffect(() => {
    setIsOnline(navigator.onLine)
    const on = () => { setIsOnline(true); triggerSync() }
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
    // Event handlers intentionally bind the current sync implementation once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Background sync interval (every 30s)
  useEffect(() => {
    syncIntervalRef.current = setInterval(() => { if (navigator.onLine) triggerSync() }, 30000)
    return () => { if (syncIntervalRef.current) clearInterval(syncIntervalRef.current) }
    // The interval invokes the mutable local database sync routine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Init
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch('/api/pharmacy/profile')
        if (res.status === 401) { router.push('/login'); return }
        const profile = await res.json()
        if (!profile.id || !profile.user_id) return
        setPharmacy({ id: profile.id, name: profile.pharmacy_name })
        setCashier({ id: profile.user_id, name: profile.pharmacy_name || 'Cashier' })
        localStorage.setItem('stocmed-pos-context', JSON.stringify({
          pharmacy_id: profile.id, cashier_id: profile.user_id,
          cashier_name: profile.pharmacy_name || 'Cashier',
        }))
        if (posLocalDb) {
          const cached = await posLocalDb.local_inventory_cache.toArray()
          if (cached.length > 0) setInventory(cached)
          const held = await posLocalDb.held_sales.toArray()
          setHeldSales(held)
          const openShift = await posLocalDb.local_shifts.where('status').equals('open').first()
          setCurrentShift(openShift ?? null)
        }
        if (navigator.onLine) {
          await syncInventoryCache(profile.id)
          fetchPopular()
        }
        updatePendingCount()
      } catch (err) { console.error('POS init error:', err) }
    }
    init()
    // Initialization runs once per router instance; cache helpers do not drive rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const updatePendingCount = async () => {
    if (!posLocalDb) return
    const [saleCount, shiftCount] = await Promise.all([
      posLocalDb.local_sales.where('sync_status').anyOf(['pending','error']).count(),
      posLocalDb.local_shifts.where('sync_status').equals('pending').count(),
    ])
    const count = saleCount + shiftCount
    setPendingCount(count)
    if (count === 0) setSyncStatus('synced')
  }

  const syncInventoryCache = async (pharmacyId: string) => {
    if (!posLocalDb) return
    try {
      const res = await fetch('/api/pharmacy/drugs')
      const data = await res.json()
      if (!data.drugs) return
      const items: LocalInventoryItem[] = data.drugs.map((drug: any) => ({
        id: drug.id, product_id: drug.product_id, generic_name: drug.generic_name,
        brand_name: drug.brand_name, strength: drug.strength, dosage_form: drug.dosage_form,
        pack_size: drug.pack_size, price: Number(drug.price),
        quantity_in_stock: Number(drug.quantity_in_stock), barcode: drug.barcode,
        batches: (drug.batches || []).map((b: any) => ({
          id: b.id, batch_number: b.batch_number, expiry_date: b.expiry_date,
          quantity_received: b.quantity_received, remaining_qty: b.remaining_qty ?? b.quantity_received,
          is_expired: b.is_expired ?? false, is_expiring_soon: b.is_expiring_soon ?? false,
        })),
      }))
      await posLocalDb.local_inventory_cache.clear()
      await posLocalDb.local_inventory_cache.bulkAdd(items)
      setInventory(items)
    } catch (err) { console.error('Cache sync error:', err) }
  }

  const fetchPopular = async () => {
    try {
      const res = await fetch('/api/pharmacy/pos/popular')
      const data = await res.json()
      if (data.popular) {
        const mapped = data.popular.map((p: any) => inventory.find(i => i.id === p.inventory_id) || null).filter(Boolean)
        if (mapped.length > 0) setPopularItems(mapped)
      }
    } catch { /* use inventory fallback */ }
  }

  const triggerSync = async () => {
    setSyncStatus('syncing')
    const result = await syncPendingSales()
    setSyncStatus(result.status)
    setPendingCount(result.pending)
    if (result.synced > 0 && pharmacy) {
      toast.success(`Synced ${result.synced} sale${result.synced > 1 ? 's' : ''}`)
      await syncInventoryCache(pharmacy.id)
    }
  }

  const handleRetry = async () => {
    await forceRetryAll()
    triggerSync()
  }

  // FEFO-powered add to cart
  const addToCart = useCallback((item: LocalInventoryItem) => {
    const existingIdx = cart.findIndex(c => c.inventory_id === item.id)
    const currentQty = existingIdx >= 0 ? cart[existingIdx].quantity : 0
    const newQty = currentQty + 1
    const result = allocateFEFO(item.batches, newQty)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    // Build cart items from FEFO allocations (one per batch)
    const newCartItems: CartItem[] = result.allocations.map(a => ({
      id: `${item.id}_${a.batch_id}`,
      inventory_id: item.id, batch_id: a.batch_id, quantity: a.quantity,
      unit_price: item.price, line_total: a.quantity * item.price,
      generic_name: item.generic_name, brand_name: item.brand_name,
      strength: item.strength, batch_number: a.batch_number, expiry_date: a.expiry_date,
    }))
    // Replace all lines for this inventory_id
    setCart(prev => [...prev.filter(c => c.inventory_id !== item.id), ...newCartItems])
  }, [cart])

  const updateCartQty = (id: string, delta: number) => {
    const item = cart.find(c => c.id === id)
    if (!item) return
    const invItem = inventory.find(i => i.id === item.inventory_id)
    if (!invItem) return
    // Get total qty for this inventory item across all batch lines
    const totalQty = cart.filter(c => c.inventory_id === item.inventory_id).reduce((s, c) => s + c.quantity, 0)
    const newTotal = totalQty + delta
    if (newTotal <= 0) {
      setCart(prev => prev.filter(c => c.inventory_id !== item.inventory_id))
      return
    }
    const result = allocateFEFO(invItem.batches, newTotal)
    if (!result.success) { toast.error(result.error); return }
    const newItems: CartItem[] = result.allocations.map(a => ({
      id: `${invItem.id}_${a.batch_id}`, inventory_id: invItem.id, batch_id: a.batch_id,
      quantity: a.quantity, unit_price: invItem.price, line_total: a.quantity * invItem.price,
      generic_name: invItem.generic_name, brand_name: invItem.brand_name,
      strength: invItem.strength, batch_number: a.batch_number, expiry_date: a.expiry_date,
    }))
    setCart(prev => [...prev.filter(c => c.inventory_id !== item.inventory_id), ...newItems])
  }

  const setDirectQty = (id: string, qty: number) => {
    const item = cart.find(c => c.id === id)
    if (!item) return
    const invItem = inventory.find(i => i.id === item.inventory_id)
    if (!invItem) return
    const result = allocateFEFO(invItem.batches, qty)
    if (!result.success) { toast.error(result.error); return }
    const newItems: CartItem[] = result.allocations.map(a => ({
      id: `${invItem.id}_${a.batch_id}`, inventory_id: invItem.id, batch_id: a.batch_id,
      quantity: a.quantity, unit_price: invItem.price, line_total: a.quantity * invItem.price,
      generic_name: invItem.generic_name, brand_name: invItem.brand_name,
      strength: invItem.strength, batch_number: a.batch_number, expiry_date: a.expiry_date,
    }))
    setCart(prev => [...prev.filter(c => c.inventory_id !== item.inventory_id), ...newItems])
  }

  const removeFromCart = (id: string) => {
    const item = cart.find(c => c.id === id)
    if (!item) return
    setCart(prev => prev.filter(c => c.inventory_id !== item.inventory_id))
  }

  // Held sales
  const holdCurrentSale = async () => {
    if (cart.length === 0) return
    const held: HeldSale = {
      id: crypto.randomUUID(), label: `Hold #${heldSales.length + 1}`,
      cart: [...cart], discount, held_at: new Date().toISOString(),
    }
    if (posLocalDb) await posLocalDb.held_sales.add(held)
    setHeldSales(prev => [...prev, held])
    setCart([]); setDiscount(0)
    toast.success('Sale held')
  }

  const resumeHeldSale = async (held: HeldSale) => {
    if (cart.length > 0) await holdCurrentSale()
    setCart(held.cart); setDiscount(held.discount)
    if (posLocalDb) await posLocalDb.held_sales.delete(held.id)
    setHeldSales(prev => prev.filter(h => h.id !== held.id))
    setShowHeldList(false)
    toast.success('Sale resumed')
  }

  // Barcode/search submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return
    const match = inventory.find(i =>
      i.barcode === searchQuery.trim() ||
      i.generic_name.toLowerCase() === searchQuery.trim().toLowerCase()
    )
    if (match) { addToCart(match); setSearchQuery(''); toast.success(`Added ${match.brand_name || match.generic_name}`) }
    else toast.error(`No match for "${searchQuery}"`)
  }

  // Checkout
  const handleCheckout = async (method: PaymentMethod, amountTendered: number | null) => {
    if (cart.length === 0 || !pharmacy || !cashier) return
    if (!currentShift) {
      toast.error('Open a shift before completing a sale')
      router.push('/pharmacy/shifts')
      return
    }
    const subtotal = cart.reduce((s, i) => s + i.line_total, 0)
    const total = Math.max(0, subtotal - discount)
    const sale: LocalSale = {
      id: crypto.randomUUID(), pharmacy_id: pharmacy.id, cashier_id: cashier.id, shift_id: currentShift.id,
      subtotal, discount, total, payment_method: method,
      amount_tendered: amountTendered, change_due: amountTendered ? Math.max(0, amountTendered - total) : null,
      status: 'completed', created_at: new Date().toISOString(), items: cart,
      sync_status: 'pending', retry_count: 0,
    }
    if (posLocalDb) {
      await posLocalDb.local_sales.add(sale)
      for (const ci of cart) {
        const inv = await posLocalDb.local_inventory_cache.get(ci.inventory_id)
        if (inv) await posLocalDb.local_inventory_cache.update(ci.inventory_id, { quantity_in_stock: Math.max(0, inv.quantity_in_stock - ci.quantity) })
      }
      const cached = await posLocalDb.local_inventory_cache.toArray()
      setInventory(cached)
    }
    setLastSale(sale); setCart([]); setDiscount(0); setShowReceipt(true)
    toast.success(isOnline ? 'Sale completed!' : 'Sale saved offline')
    if (isOnline) triggerSync()
    else { setSyncStatus('pending'); updatePendingCount() }
  }

  // Filter
  const filtered = searchQuery.trim()
    ? inventory.filter(i => {
        const q = searchQuery.toLowerCase()
        return i.generic_name.toLowerCase().includes(q) || (i.brand_name?.toLowerCase().includes(q)) || (i.barcode?.includes(searchQuery))
      })
    : []

  const quickTap = popularItems.length > 0 ? popularItems.slice(0, 12) : inventory.filter(i => i.quantity_in_stock > 0).slice(0, 12)
  const subtotal = cart.reduce((s, i) => s + i.line_total, 0)
  const total = Math.max(0, subtotal - discount)

  return (
    <div className="flex min-h-[calc(100vh-10rem)] flex-col overflow-hidden bg-[var(--pos-bg)] text-white lg:h-full lg:min-h-0">
      {/* Header */}
      <header className="bg-[var(--pos-panel)] border-b border-white/10 px-4 py-3 flex justify-between items-center flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="bg-[var(--primary)] w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-xs">SM</div>
          <div>
            <h1 className="font-semibold text-sm text-white">StocMed POS</h1>
            <p className="text-[10px] text-white/40">{pharmacy?.name || 'Loading...'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SyncPill isOnline={isOnline} syncStatus={syncStatus} pendingCount={pendingCount} onRetry={handleRetry} />
          <Button onClick={() => router.push('/pharmacy/shifts')} className="px-2.5 py-1.5 bg-[var(--pos-control)] hover:bg-white/5 rounded text-white/60 text-[11px] flex items-center gap-1 border border-white/10 transition">
            <Banknote className="h-3 w-3" /> {currentShift ? 'Shift open' : 'Open shift'}
          </Button>
          <div className="text-white/40 text-[11px] hidden md:flex items-center gap-1">
            <User className="h-3.5 w-3.5" /> {cashier?.name || 'Cashier'}
          </div>
        </div>
      </header>

      {/* Main workspace */}
      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* Left: Search + Catalog */}
        <div className="flex min-h-[430px] flex-[2] flex-col overflow-hidden border-b border-white/10 lg:min-h-0 lg:border-b-0 lg:border-r">
          {/* Search */}
          <form onSubmit={handleSearchSubmit} className="p-4 pb-2 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 h-4 w-4" />
              <input ref={searchRef} type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Scan barcode or type medication name..."
                className="w-full bg-[var(--pos-panel)] border border-white/10 text-white pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] transition placeholder:text-white/25"
                autoFocus />
            </div>
          </form>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {/* Search results */}
            {searchQuery.trim() && (
              <div className="mb-4">
                <h3 className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2">
                  {filtered.length} result{filtered.length !== 1 ? 's' : ''}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                  {filtered.slice(0, 18).map(item => {
                    const oos = item.quantity_in_stock <= 0
                    return (
                      <Button key={item.id} onClick={() => { if (!oos) { addToCart(item); setSearchQuery('') } }}
                        disabled={oos}
                        className={`text-left bg-[var(--pos-panel)] border rounded-lg p-3 transition ${oos ? 'border-white/5 opacity-40 cursor-not-allowed' : 'border-white/10 hover:border-[var(--primary)]/60 hover:bg-white/5 cursor-pointer'}`}>
                        <div className="flex justify-between items-start gap-1">
                          <h4 className="font-semibold text-[11px] text-white truncate">{item.brand_name || item.generic_name}</h4>
                          {item.dosage_form && <span className="text-[9px] bg-white/5 text-white/40 px-1.5 py-0.5 rounded capitalize flex-shrink-0">{item.dosage_form}</span>}
                        </div>
                        {item.brand_name && <p className="text-[10px] text-white/30 truncate">{item.generic_name}</p>}
                        <div className="flex justify-between items-end mt-2">
                          <span className="text-xs font-bold text-[var(--pos-accent)]">₦{item.price.toLocaleString()}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${oos ? 'text-[var(--pos-danger)] bg-[var(--pos-danger)]/10' : item.quantity_in_stock <= 10 ? 'text-[var(--pos-warning)] bg-[var(--pos-warning)]/10' : 'text-[var(--pos-success)] bg-[var(--pos-success)]/10'}`}>
                            {oos ? 'Out' : `${item.quantity_in_stock} units`}
                          </span>
                        </div>
                      </Button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Quick-tap grid */}
            {!searchQuery.trim() && (
              <div>
                <h3 className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Zap className="h-3 w-3" /> Quick Tap — Top Sellers
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {quickTap.map(item => {
                    const oos = item.quantity_in_stock <= 0
                    return (
                      <Button key={item.id} onClick={() => !oos && addToCart(item)} disabled={oos}
                        className={`text-left bg-[var(--pos-panel)] border rounded-xl p-3 transition ${oos ? 'border-white/5 opacity-40 cursor-not-allowed' : 'border-white/10 hover:border-[var(--primary)]/60 hover:bg-white/5'}`}>
                        <h4 className="font-semibold text-[11px] text-white truncate">{item.brand_name || item.generic_name}</h4>
                        <p className="text-[10px] text-white/30 truncate">{item.strength} · {item.dosage_form}</p>
                        <div className="flex justify-between items-center mt-2">
                          <span className="text-xs font-bold text-[var(--pos-accent)]">₦{item.price.toLocaleString()}</span>
                          <span className="text-[9px] text-white/30">{item.quantity_in_stock} left</span>
                        </div>
                      </Button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Cart + Checkout */}
        <div className="flex min-h-[520px] w-full min-w-0 flex-1 flex-col lg:min-h-0 lg:max-w-[420px]">
          <div className="flex-1 overflow-hidden flex flex-col">
            <CartPanel cart={cart} discount={discount}
              onUpdateQty={updateCartQty} onDirectQty={setDirectQty}
              onRemove={removeFromCart} onClearCart={() => setCart([])}
              onSetDiscount={setDiscount} onHoldSale={holdCurrentSale}
              heldCount={heldSales.length}
              onResumeHeld={() => setShowHeldList(true)} />
          </div>
          <div className="p-3 border-t border-white/10 bg-[var(--pos-bg)]/80 flex-shrink-0">
            {!currentShift && <Button onClick={() => router.push('/pharmacy/shifts')} className="mb-2 w-full rounded-lg border border-white/20 bg-[var(--pos-control)] px-3 py-2 text-xs font-semibold text-white">Open shift to sell</Button>}
            <CheckoutPanel total={total} cartEmpty={cart.length === 0 || !currentShift} isOnline={isOnline} onCheckout={handleCheckout} />
          </div>
        </div>
      </div>

      {/* Receipt modal */}
      {showReceipt && lastSale && (
        <ReceiptModal sale={lastSale} pharmacyName={pharmacy?.name || ''} cashierName={cashier?.name || ''} isOnline={isOnline} onClose={() => setShowReceipt(false)} />
      )}

      {/* Held sales list */}
      {showHeldList && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--pos-panel)] rounded-2xl max-w-sm w-full p-5 border border-white/10 shadow-2xl">
            <h2 className="font-bold text-base text-white mb-3">Held Sales</h2>
            {heldSales.length === 0 ? (
              <p className="text-xs text-white/40 py-6 text-center">No held sales</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {heldSales.map(h => (
                  <Button key={h.id} onClick={() => resumeHeldSale(h)}
                    className="w-full text-left bg-[var(--pos-bg)] p-3 rounded-lg border border-white/10 hover:border-[var(--primary)]/50 transition">
                    <div className="flex justify-between">
                      <span className="text-xs font-semibold text-white">{h.label}</span>
                      <span className="text-[10px] text-white/40">{new Date(h.held_at).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-[10px] text-white/40 mt-1">{h.cart.length} item{h.cart.length !== 1 ? 's' : ''} · ₦{h.cart.reduce((s,i) => s + i.line_total, 0).toLocaleString()}</p>
                  </Button>
                ))}
              </div>
            )}
            <Button onClick={() => setShowHeldList(false)} className="w-full mt-3 py-2 bg-white/5 hover:bg-white/10 text-white/60 rounded-lg text-xs font-medium transition">Close</Button>
          </div>
        </div>
      )}

    </div>
  )
}
