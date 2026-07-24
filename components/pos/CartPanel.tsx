'use client'

import { Button } from '@/components/ui/button'

import React, { useState } from 'react'
import { Minus, Plus, Trash2, X } from 'lucide-react'
import type { LocalSaleItem } from '@/lib/db/pos-local-db'
import { formatExpShort } from '@/lib/pos/fefo'

type CartItem = LocalSaleItem & { id: string }

interface CartPanelProps {
  cart: CartItem[]
  discount: number
  onUpdateQty: (id: string, delta: number) => void
  onDirectQty: (id: string, qty: number) => void
  onRemove: (id: string) => void
  onClearCart: () => void
  onSetDiscount: (v: number) => void
  onHoldSale: () => void
  heldCount: number
  onResumeHeld: () => void
}

export default function CartPanel({
  cart, discount, onUpdateQty, onDirectQty, onRemove,
  onClearCart, onSetDiscount, onHoldSale, heldCount, onResumeHeld,
}: CartPanelProps) {
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null)
  const [editingQtyVal, setEditingQtyVal] = useState('')

  const subtotal = cart.reduce((s, i) => s + i.line_total, 0)
  const total = Math.max(0, subtotal - discount)

  const startDirectEntry = (id: string, current: number) => {
    setEditingQtyId(id)
    setEditingQtyVal(String(current))
  }

  const commitDirectEntry = (id: string) => {
    const val = parseInt(editingQtyVal, 10)
    if (!isNaN(val) && val > 0) onDirectQty(id, val)
    setEditingQtyId(null)
  }

  return (
    <div className="bg-[var(--pos-panel)] flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex justify-between items-center flex-shrink-0">
        <h2 className="font-semibold text-white flex items-center gap-2 text-sm">
          Cart <span className="bg-[var(--primary)] text-white text-[10px] px-2 py-0.5 rounded-full font-bold">{cart.length}</span>
        </h2>
        <div className="flex items-center gap-2">
          {heldCount > 0 && (
            <Button onClick={onResumeHeld} className="text-[10px] text-[var(--pos-warning)] hover:text-white border border-[var(--pos-warning)]/30 px-2 py-1 rounded transition">
              Resume ({heldCount})
            </Button>
          )}
          {cart.length > 0 && (
            <>
              <Button onClick={onHoldSale} className="text-[10px] text-[var(--pos-accent)] hover:text-white border border-[var(--pos-accent)]/30 px-2 py-1 rounded transition">
                Hold
              </Button>
              <Button onClick={onClearCart} className="text-[10px] text-white/40 hover:text-[var(--pos-danger)] transition">
                Clear
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-white/30 py-12 gap-2">
            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
              <Plus className="h-5 w-5" />
            </div>
            <p className="text-xs font-medium">Scan or search to add items</p>
          </div>
        ) : (
          cart.map(item => (
            <div key={item.id} className="bg-[var(--pos-bg)] p-3 rounded-lg border border-white/5">
              <div className="flex justify-between items-start mb-1">
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-[11px] text-white truncate">
                    {item.brand_name || item.generic_name}
                  </h4>
                  <p className="text-[10px] text-white/40">{item.strength}</p>
                  {item.expiry_date && (
                    <p className="text-[10px] text-[var(--pos-success)]/70 mt-0.5">
                      Exp: {formatExpShort(item.expiry_date)}
                    </p>
                  )}
                </div>
                <Button onClick={() => onRemove(item.id)} className="text-white/20 hover:text-[var(--pos-danger)] p-0.5 transition">
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex justify-between items-center mt-2">
                <div className="flex items-center bg-[var(--pos-panel)] rounded border border-white/10">
                  <Button onClick={() => onUpdateQty(item.id, -1)} className="px-2 py-1 text-white/50 hover:text-white">
                    <Minus className="h-3 w-3" />
                  </Button>
                  {editingQtyId === item.id ? (
                    <input
                      type="number"
                      value={editingQtyVal}
                      onChange={e => setEditingQtyVal(e.target.value)}
                      onBlur={() => commitDirectEntry(item.id)}
                      onKeyDown={e => e.key === 'Enter' && commitDirectEntry(item.id)}
                      className="w-10 text-center text-xs bg-transparent text-white border-none outline-none"
                      autoFocus
                    />
                  ) : (
                    <Button
                      onClick={() => startDirectEntry(item.id, item.quantity)}
                      className="px-2 text-xs font-semibold text-white/80 hover:text-[var(--pos-accent)] cursor-text min-w-[28px] text-center"
                    >
                      {item.quantity}
                    </Button>
                  )}
                  <Button onClick={() => onUpdateQty(item.id, 1)} className="px-2 py-1 text-white/50 hover:text-white">
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-white/30">₦{item.unit_price.toLocaleString()} × {item.quantity}</span>
                  <p className="text-xs font-bold text-white">₦{item.line_total.toLocaleString()}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Totals */}
      <div className="p-4 border-t border-white/10 bg-[var(--pos-bg)]/60 flex-shrink-0">
        <div className="space-y-1.5 mb-3">
          <div className="flex justify-between text-[11px] text-white/50">
            <span>Subtotal</span><span>₦{subtotal.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center text-[11px] text-white/50">
            <span>Discount</span>
            <input
              type="number" value={discount === 0 ? '' : discount}
              onChange={e => onSetDiscount(Math.max(0, Number(e.target.value)))}
              placeholder="0" className="w-20 bg-[var(--pos-panel)] border border-white/10 rounded px-2 py-0.5 text-right text-white text-[11px] focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
        </div>
        <div className="flex justify-between items-baseline border-t border-white/10 pt-2">
          <span className="text-sm font-semibold text-white">TOTAL</span>
          <span className="text-2xl font-extrabold text-[var(--pos-success)]">₦{total.toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}
