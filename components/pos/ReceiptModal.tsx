'use client'

import { Button } from '@/components/ui/button'

import React from 'react'
import { CheckCircle, Printer, Share2 } from 'lucide-react'
import type { LocalSale } from '@/lib/db/pos-local-db'
import { formatExpShort } from '@/lib/pos/fefo'

interface ReceiptModalProps {
  sale: LocalSale
  pharmacyName: string
  cashierName: string
  isOnline: boolean
  onClose: () => void
}

export default function ReceiptModal({ sale, pharmacyName, cashierName, isOnline, onClose }: ReceiptModalProps) {
  const handlePrint = () => {
    // In production: trigger Bluetooth thermal printer via Web Bluetooth API
    window.print()
  }

  const handleShare = async () => {
    const receiptText = buildReceiptText(sale, pharmacyName, cashierName)
    if (navigator.share) {
      try {
        await navigator.share({ title: 'StocMed Receipt', text: receiptText })
      } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(receiptText)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[var(--pos-panel)] rounded-2xl max-w-sm w-full p-5 border border-white/10 flex flex-col gap-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex flex-col items-center text-center gap-1 border-b border-white/10 pb-3">
          <CheckCircle className="h-10 w-10 text-[var(--pos-success)]" />
          <h2 className="font-bold text-base text-white">Sale Complete!</h2>
          <p className="text-[10px] text-white/50">
            {isOnline ? 'Synced to cloud' : 'Saved offline — will sync automatically'}
          </p>
        </div>

        {/* Thermal receipt preview */}
        <div className="bg-white text-[var(--pos-bg)] font-mono text-[9px] p-3 rounded-lg" id="receipt-print-area">
          <div className="text-center font-bold uppercase tracking-wider text-[10px] mb-1">StocMed Pharmacy Receipt</div>
          <div className="text-center text-[8px] mb-2">{pharmacyName}</div>
          <div className="border-t border-dashed border-border py-1.5 space-y-0.5">
            <div>DATE: {new Date(sale.created_at).toLocaleString()}</div>
            <div>RECEIPT: {sale.id.substring(0, 8).toUpperCase()}</div>
            <div>CASHIER: {cashierName}</div>
            <div>PAYMENT: {sale.payment_method.replace(/_/g, ' ').toUpperCase()}</div>
          </div>
          <div className="border-t border-b border-dashed border-border py-1.5 my-1">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border font-bold">
                  <th className="py-0.5">Item</th>
                  <th className="py-0.5 text-center">Qty</th>
                  <th className="py-0.5 text-right">Amt</th>
                </tr>
              </thead>
              <tbody>
                {sale.items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="py-0.5">
                      {item.brand_name || item.generic_name}
                      <div className="text-[7px] text-ink-light">
                        {item.strength} · B:{item.batch_number} · Exp:{formatExpShort(item.expiry_date)}
                      </div>
                    </td>
                    <td className="py-0.5 text-center">{item.quantity}</td>
                    <td className="py-0.5 text-right">₦{item.line_total.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-0.5 text-right">
            <div>SUBTOTAL: ₦{sale.subtotal.toLocaleString()}</div>
            {sale.discount > 0 && <div>DISCOUNT: -₦{sale.discount.toLocaleString()}</div>}
            <div className="font-bold text-[10px]">TOTAL: ₦{sale.total.toLocaleString()}</div>
            {sale.amount_tendered && <div>TENDERED: ₦{sale.amount_tendered.toLocaleString()}</div>}
            {sale.change_due && sale.change_due > 0 && <div>CHANGE: ₦{sale.change_due.toLocaleString()}</div>}
          </div>
          <div className="border-t border-dashed border-border mt-2 pt-1.5 text-center text-[7px] text-ink-light">
            Thank you for your patronage!
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={handlePrint} className="flex-1 py-2 bg-[var(--pos-control)] hover:bg-white/5 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border border-white/10 transition">
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
          <Button onClick={handleShare} className="py-2 px-3 bg-[var(--pos-control)] hover:bg-white/5 text-white rounded-lg text-xs font-semibold flex items-center justify-center border border-white/10 transition">
            <Share2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Button onClick={onClose} className="w-full bg-[var(--primary)] hover:bg-[var(--primary-mid)] text-white py-2.5 rounded-lg font-bold text-sm transition">
          New Sale
        </Button>
      </div>
    </div>
  )
}

function buildReceiptText(sale: LocalSale, pharmacy: string, cashier: string): string {
  const lines = [
    'STOCMED PHARMACY RECEIPT',
    pharmacy,
    `Date: ${new Date(sale.created_at).toLocaleString()}`,
    `Receipt: ${sale.id.substring(0, 8).toUpperCase()}`,
    `Cashier: ${cashier}`,
    '---',
    ...sale.items.map(i =>
      `${i.brand_name || i.generic_name} (${i.strength}) x${i.quantity} = ₦${i.line_total.toLocaleString()}`
    ),
    '---',
    `TOTAL: ₦${sale.total.toLocaleString()}`,
    `Payment: ${sale.payment_method.replace(/_/g, ' ')}`,
  ]
  if (sale.amount_tendered) lines.push(`Tendered: ₦${sale.amount_tendered.toLocaleString()}`)
  if (sale.change_due && sale.change_due > 0) lines.push(`Change: ₦${sale.change_due.toLocaleString()}`)
  return lines.join('\n')
}
