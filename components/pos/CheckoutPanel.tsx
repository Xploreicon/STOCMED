'use client'

import { Button } from '@/components/ui/button'

import React, { useState } from 'react'
import { Coins, CreditCard, Building2, MoreHorizontal, ArrowRight, Calculator } from 'lucide-react'

type PaymentMethod = 'cash' | 'bank_transfer' | 'pharmacy_pos_terminal' | 'credit' | 'other'

interface CheckoutPanelProps {
  total: number
  cartEmpty: boolean
  isOnline: boolean
  allowCredit?: boolean
  onCheckout: (method: PaymentMethod, amountTendered: number | null) => void
}

const METHODS: { key: PaymentMethod; label: string; icon: React.ReactNode }[] = [
  { key: 'cash', label: 'Cash', icon: <Coins className="h-4 w-4" /> },
  { key: 'bank_transfer', label: 'Transfer', icon: <Building2 className="h-4 w-4" /> },
  { key: 'pharmacy_pos_terminal', label: 'POS Terminal', icon: <CreditCard className="h-4 w-4" /> },
  { key: 'credit', label: 'Credit', icon: <CreditCard className="h-4 w-4" /> },
  { key: 'other', label: 'Other', icon: <MoreHorizontal className="h-4 w-4" /> },
]

export default function CheckoutPanel({ total, cartEmpty, isOnline, allowCredit = false, onCheckout }: CheckoutPanelProps) {
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [showCheckout, setShowCheckout] = useState(false)
  const [amountTendered, setAmountTendered] = useState<string>('')

  const tendered = parseFloat(amountTendered) || 0
  const changeDue = Math.max(0, tendered - total)
  const canComplete = method !== 'cash' || tendered >= total

  const handleComplete = () => {
    onCheckout(method, method === 'cash' ? tendered : null)
    setShowCheckout(false)
    setAmountTendered('')
  }

  if (!showCheckout) {
    return (
      <Button
        onClick={() => setShowCheckout(true)}
        disabled={cartEmpty}
        className="w-full bg-[var(--pos-success)] hover:bg-[var(--success-bright)] disabled:opacity-30 disabled:cursor-not-allowed text-[var(--pos-bg)] py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition"
      >
        Checkout <ArrowRight className="h-4 w-4" />
      </Button>
    )
  }

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* Payment method selector */}
      <div className="grid grid-cols-2 gap-1.5">
        {METHODS.filter(m => m.key !== 'credit' || allowCredit).map(m => (
          <Button
            key={m.key} type="button" onClick={() => setMethod(m.key)}
            className={`py-2 px-2 rounded-lg border text-[11px] font-medium transition flex items-center justify-center gap-1.5 ${
              method === m.key
                ? 'bg-[var(--primary)]/20 border-[var(--primary)] text-[var(--pos-accent)]'
                : 'bg-[var(--pos-panel)] border-white/10 text-white/50 hover:bg-white/5'
            }`}
          >
            {m.icon} {m.label}
          </Button>
        ))}
      </div>

      {/* Cash change calculator */}
      {method === 'cash' && (
        <div className="bg-[var(--pos-panel)] rounded-lg border border-white/10 p-3 space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-white/50 font-medium">
            <Calculator className="h-3.5 w-3.5" /> Change Calculator
          </div>
          <div>
            <label className="text-[10px] text-white/40 block mb-1">Amount Tendered</label>
            <input
              type="number" value={amountTendered}
              onChange={e => setAmountTendered(e.target.value)}
              placeholder={`Min ₦${total.toLocaleString()}`}
              className="w-full bg-[var(--pos-bg)] border border-white/10 rounded-lg px-3 py-2.5 text-white text-lg font-bold text-right focus:outline-none focus:border-[var(--primary)] transition"
              autoFocus
            />
          </div>
          {tendered > 0 && (
            <div className={`text-right py-2 px-3 rounded-lg ${tendered >= total ? 'bg-[var(--pos-success)]/10 border border-[var(--pos-success)]/20' : 'bg-[var(--pos-danger)]/10 border border-[var(--pos-danger)]/20'}`}>
              <span className="text-[10px] text-white/50 block">Change Due</span>
              <span className={`text-xl font-extrabold ${tendered >= total ? 'text-[var(--pos-success)]' : 'text-[var(--pos-danger)]'}`}>
                ₦{changeDue.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          onClick={() => { setShowCheckout(false); setAmountTendered('') }}
          className="px-3 py-2.5 border border-white/10 rounded-lg text-white/50 text-xs hover:bg-white/5 transition"
        >
          Back
        </Button>
        <Button
          onClick={handleComplete}
          disabled={!canComplete}
          className="flex-1 bg-[var(--pos-success)] hover:bg-[var(--success-bright)] disabled:opacity-30 disabled:cursor-not-allowed text-[var(--pos-bg)] py-2.5 rounded-lg font-bold text-sm transition"
        >
          {isOnline ? 'Complete Sale' : 'Save Offline'}
        </Button>
      </div>
    </div>
  )
}
