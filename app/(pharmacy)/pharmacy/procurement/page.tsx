'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArchiveRestore, Check, ClipboardList, PackageCheck, Plus, Search,
  Send, Share2, Truck, UserRoundPlus, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

type Supplier = {
  id: string; name: string; contact_person: string | null; phone: string | null
  email: string | null; address: string | null; payment_terms: string | null
  notes: string | null; is_active: boolean
}
import { ProcurementProductPicker } from '@/components/pharmacy/ProcurementProductPicker'
import { StaffSwitcher } from '@/components/pos/StaffSwitcher'
import { usePharmacyFeatures } from '@/components/providers/PharmacyFeaturesProvider'
import { withStaffSessionHeader, type StaffSession } from '@/lib/staff-session-client'
import { SpAuthorizationModal } from '@/components/pharmacy/SpAuthorizationModal'
import { getCachedSpToken, clearCachedSpToken } from '@/lib/sp-authorization-client'
import type { SpAction } from '@/lib/sp-authorization'
import { procurementProductLabel, receivingBaseQuantity, receiptRequest, type ProcurementProduct as Product } from '@/lib/procurement'

type POItem = {
  id: string; product_id: string | null; inventory_id: string | null
  quantity_ordered: number; quantity_received: number
  unit_cost: number; line_total: number; products: Product | null
  pharmacy_inventory: {
    id: string; item_name: string; brand: string | null; barcode: string | null
    unit_description: string | null; store_category: string | null; tracks_expiry: boolean; base_unit_name?: string
  } | null
}
type PurchaseOrder = {
  id: string; supplier_id: string; po_number: string; status: string; expected_date: string | null
  subtotal: number; received_total?: number; notes: string | null; created_at: string; suppliers: Supplier
  purchase_order_items: POItem[]
}
type DraftLine = { product: Product; quantity_ordered: number; unit_cost: number }
type ReceivingLine = {
  po_item_id: string | null; product_id: string | null; inventory_id: string | null; product: Product
  quantity_received: number; batch_number: string; expiry_date: string
  unit_cost: number; short_dated_confirmed: boolean; receiving_unit: 'base' | 'pack'; units_per_pack: number; selling_price: string; base_unit_name: string; restore_deleted: boolean; remaining?: number
}

const money = (value: number) => `₦${Number(value || 0).toLocaleString()}`
const productLabel = procurementProductLabel

const poItemProduct = (item: POItem): Product => item.products
  ? { ...item.products, target_type: 'medicine', product_id: item.product_id, inventory_id: null, tracks_expiry: true }
  : {
      id: item.pharmacy_inventory!.id,
      target_type: 'store',
      product_id: null,
      inventory_id: item.inventory_id,
      generic_name: item.pharmacy_inventory!.item_name,
      brand_name: item.pharmacy_inventory!.brand,
      strength: item.pharmacy_inventory!.unit_description || '',
      dosage_form: item.pharmacy_inventory!.store_category,
      pack_size: item.pharmacy_inventory!.unit_description,
      barcode: item.pharmacy_inventory!.barcode,
      tracks_expiry: item.pharmacy_inventory!.tracks_expiry,
      base_unit_name: item.pharmacy_inventory!.base_unit_name,
    }

async function readProcurement(view: string) {
  const response = await fetch(`/api/pharmacy/procurement?view=${view}`)
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || 'Could not load procurement data')
  return body
}

type WriteResult = { receipt_number?: string; replayed?: boolean }

type Receipt = {
  id: string; receipt_number: string; received_at: string; reversed_at: string | null; reversal_reason: string | null
  invoice_reference: string | null; request_key: string | null; suppliers: { name: string }; purchase_orders: { po_number: string } | null
  goods_receipt_items: { id: string; quantity_received: number; unit_cost: number; line_total: number; products: { generic_name: string; brand_name: string | null; strength: string } | null;
    pharmacy_inventory: { item_name: string; unit_description: string | null } | null; batches: { batch_number: string; expiry_date: string } | null }[]
}

export default function ProcurementPage() {
  const [tab, setTab] = useState('suppliers')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [traceRows, setTraceRows] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const { isEnabled } = usePharmacyFeatures()
  const [staffSession, setStaffSession] = useState<StaffSession | null>(null)
  const [loadError, setLoadError] = useState('')
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [authorization, setAuthorization] = useState<{ action: SpAction; retry: () => Promise<WriteResult> } | null>(null)
  const retryKey = useRef<{ payload: string; key: string } | null>(null)
  const [invoiceReference, setInvoiceReference] = useState('')
  const [confirmReceive, setConfirmReceive] = useState(false)
  const [reverseReceipt, setReverseReceipt] = useState<Receipt | null>(null)
  const [reversalReason, setReversalReason] = useState('')
  const [editingPO, setEditingPO] = useState<string | null>(null)
  const [receiptPage, setReceiptPage] = useState(0)
  const [moreReceipts, setMoreReceipts] = useState(false)
  const api = async (body: Record<string, unknown>): Promise<WriteResult> => {
    const response = await fetch('/api/pharmacy/procurement', {
      method: 'POST', headers: withStaffSessionHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ...body, authorization: Object.fromEntries(['price_change','restore_inventory','stock_adjustment'].map(action => [action, getCachedSpToken(action as SpAction)])) }),
    })
    const data = await response.json()
    if (!response.ok) {
      if (data.code === 'SP_AUTH_REQUIRED' && ['price_change','restore_inventory','stock_adjustment'].includes(data.action)) {
        clearCachedSpToken(data.action)
        setAuthorization({ action: data.action, retry: () => api(body) })
      }
      throw new Error(data.error || 'Request failed')
    }
    return data
  }

  const loadCore = useCallback(async () => {
    try {
      const [supplierRes, orderRes, receiptRes] = await Promise.all([
        readProcurement('suppliers'), readProcurement('orders'), readProcurement('receipts'),
      ])
      setSuppliers(supplierRes.suppliers); setOrders(orderRes.orders); setReceipts(receiptRes.receipts)
      setMoreReceipts(receiptRes.has_more); setReceiptPage(0); setLoadError('')
    } catch (failure) {
      setLoadError(failure instanceof Error ? failure.message : 'Could not load procurement data')
      throw failure
    }
  }, [])
  useEffect(() => { void loadCore().catch(() => undefined) }, [loadCore])
  const changeReceiptPage = async (page: number) => {
    try { const data = await readProcurement(`receipts&page=${page}`); setReceipts(data.receipts); setMoreReceipts(data.has_more); setReceiptPage(page) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not load receipts') }
  }

  const [supplierForm, setSupplierForm] = useState({
    name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '', notes: '',
  })
  const createSupplier = async () => {
    setBusy(true)
    try {
      await api({ action: 'supplier_create', ...supplierForm })
      setSupplierForm({ name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '', notes: '' })
      await loadCore(); toast.success('Supplier added')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not add supplier') }
    finally { setBusy(false) }
  }

  const [poSupplier, setPoSupplier] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [poNotes, setPoNotes] = useState('')
  const [draftLines, setDraftLines] = useState<DraftLine[]>([])
  const addDraftLine = (product: Product) => {
    if (!product || draftLines.some(line => line.product.id === product.id)) return
    setDraftLines(lines => [...lines, { product, quantity_ordered: 1, unit_cost: 0 }])
  }
  const createPO = async () => {
    setBusy(true)
    try {
      await api({
        action: editingPO ? 'po_update' : 'po_create', id: editingPO, supplier_id: poSupplier, expected_date: expectedDate || null,
        notes: poNotes, items: draftLines.map(line => ({
          product_id: line.product.product_id,
          inventory_id: line.product.inventory_id,
          quantity_ordered: line.quantity_ordered,
          unit_cost: line.unit_cost,
        })),
      })
      setDraftLines([]); setPoNotes(''); setExpectedDate(''); setEditingPO(null); await loadCore()
      toast.success('Draft purchase order saved')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create PO') }
    finally { setBusy(false) }
  }
  const updatePOStatus = async (id: string, status: 'sent' | 'cancelled') => {
    try { await api({ action: 'po_status', id, status }); await loadCore(); toast.success(`PO marked ${status}`) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update PO') }
  }
  const sharePO = async (order: PurchaseOrder) => {
    const lines = order.purchase_order_items.map(item =>
      `${productLabel(poItemProduct(item))} × ${item.quantity_ordered} base units @ ${money(item.unit_cost)} per base unit`
    ).join('\n')
    const text = `${order.po_number}\nSupplier: ${order.suppliers.name}\n${lines}\nTotal: ${money(order.subtotal)}`
    try {
      if (navigator.share) await navigator.share({ title: order.po_number, text })
      else { await navigator.clipboard.writeText(text); toast.success('PO copied for WhatsApp or email') }
    } catch { /* Share sheet cancelled. */ }
  }

  const openOrders = useMemo(() => orders.filter(order => ['sent', 'partially_received'].includes(order.status)), [orders])
  const [receiveMode, setReceiveMode] = useState<'po' | 'direct'>('po')
  const [receivePO, setReceivePO] = useState('')
  const [receiveSupplier, setReceiveSupplier] = useState('')
  const [receivingLines, setReceivingLines] = useState<ReceivingLine[]>([])
  const [receiveNotes, setReceiveNotes] = useState('')
  const [scanValue, setScanValue] = useState('')

  const selectPOForReceipt = (poId: string) => {
    setReceivePO(poId)
    const order = orders.find(item => item.id === poId)
    if (!order) { setReceivingLines([]); return }
    setReceiveSupplier(order.supplier_id)
    setReceivingLines(order.purchase_order_items
      .filter(item => item.quantity_received < item.quantity_ordered)
      .map(item => {
        const product = poItemProduct(item)
        return {
        po_item_id: item.id, product_id: item.product_id, inventory_id: item.inventory_id, product,
        quantity_received: 0,
        batch_number: '', expiry_date: '', unit_cost: Number(item.unit_cost), short_dated_confirmed: false, receiving_unit: 'base', units_per_pack: 1, selling_price: '', base_unit_name: product.base_unit_name || 'unit', restore_deleted: false, remaining: item.quantity_ordered - item.quantity_received,
      }}))
  }
  const addDirectLine = (product: Product) => {
    setReceivingLines(lines => [...lines, {
      po_item_id: null, product_id: product.product_id, inventory_id: product.inventory_id,
      product, quantity_received: 1,
      batch_number: '', expiry_date: '', unit_cost: 0, short_dated_confirmed: false, receiving_unit: 'base', units_per_pack: 1, selling_price: '', base_unit_name: product.base_unit_name || 'unit', restore_deleted: false,
    }])
  }
  const updateReceivingLine = (index: number, patch: Partial<ReceivingLine>) =>
    setReceivingLines(lines => lines.map((line, i) => i === index ? { ...line, ...patch } : line))
  const isShortDated = (date: string) => {
    if (!date) return false
    const limit = new Date(); limit.setMonth(limit.getMonth() + 4)
    return new Date(date) < limit
  }
  const jumpByBarcode = () => {
    const index = receivingLines.findIndex(line => line.product.barcode === scanValue.trim())
    if (index < 0) return toast.error('Barcode is not on this receipt')
    document.getElementById(`receive-line-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setScanValue('')
  }
  const deliveredLines = receivingLines.filter(line => line.quantity_received > 0)
  const receiptTotal = deliveredLines.reduce((total, line) => total + line.quantity_received * line.unit_cost, 0)
  const invalidReceipt = receivingLines.some(line => line.quantity_received < 0 || !Number.isInteger(line.quantity_received)) || deliveredLines.length === 0 || !receiveSupplier || deliveredLines.some(line =>
    !Number.isInteger(line.quantity_received) || !Number.isInteger(line.units_per_pack) || line.units_per_pack < 1 || line.unit_cost < 0 ||
    (line.product.is_new && !(Number(line.selling_price) > 0)) ||
    (line.product.deleted_at && !line.restore_deleted) ||
    (line.product.tracks_expiry && (!line.batch_number || !line.expiry_date || line.expiry_date <= new Date().toLocaleDateString('en-CA') || (isShortDated(line.expiry_date) && !line.short_dated_confirmed))) ||
    (line.remaining !== undefined && deliveredLines.filter(other => other.po_item_id === line.po_item_id).reduce((sum, other) => sum + receivingBaseQuantity(other), 0) > line.remaining))
  const finishReceipt = async (result: { receipt_number: string; replayed?: boolean }) => {
    retryKey.current = null; window.sessionStorage.removeItem('stocmed-procurement-retry')
    setReceivingLines([]); setReceivePO(''); setReceiveNotes(''); setInvoiceReference(''); setConfirmReceive(false)
    toast.success(`${result.receipt_number} ${result.replayed ? 'already recorded — no stock added twice' : 'received and added to stock'}`)
    await loadCore()
  }
  const commitReceipt = async () => {
    if (invalidReceipt) return
    setBusy(true)
    try {
      const payload = { action: 'receive', supplier_id: receiveSupplier, po_id: receiveMode === 'po' ? receivePO : null,
        notes: receiveNotes, invoice_reference: invoiceReference, lines: deliveredLines.map(({ product, remaining, ...line }) => line) }
      let previous = retryKey.current
      try { previous = JSON.parse(window.sessionStorage.getItem('stocmed-procurement-retry') || 'null') } catch { /* Start with an empty retry cache. */ }
      retryKey.current = receiptRequest(payload, previous)
      window.sessionStorage.setItem('stocmed-procurement-retry', JSON.stringify(retryKey.current))
      const result = await api({ ...payload, request_key: retryKey.current.key })
      if (!result.receipt_number) throw new Error('Receipt confirmation missing. Check receipt history before retrying.')
      await finishReceipt({ ...result, receipt_number: result.receipt_number })
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Receiving failed. Check receipt history, then retry the same delivery.') }
    finally { setBusy(false) }
  }
  const editOrder = (order: PurchaseOrder) => {
    setEditingPO(order.id); setPoSupplier(order.supplier_id); setExpectedDate(order.expected_date || ''); setPoNotes(order.notes || '')
    setDraftLines(order.purchase_order_items.map(item => ({ product: poItemProduct(item), quantity_ordered: item.quantity_ordered, unit_cost: Number(item.unit_cost) })))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const reverseDelivery = async () => {
    if (!reverseReceipt) return
    setBusy(true)
    try { await api({ action: 'receipt_reverse', id: reverseReceipt.id, reason: reversalReason }); setReverseReceipt(null); setReversalReason(''); await loadCore(); toast.success('Receipt reversed; stock and order quantities updated') }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not reverse receipt') }
    finally { setBusy(false) }
  }

  const loadTrace = async (query = '') => {
    const response = await fetch(`/api/pharmacy/procurement?view=trace&q=${encodeURIComponent(query)}`)
    const data = await response.json()
    if (!response.ok) return toast.error(data.error || 'Could not load batch trace')
    setTraceRows(data.batches || [])
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-bold text-ink">Procurement</h1><p className="text-sm text-ink-muted">Suppliers, purchase orders, receiving, and batch traceability.</p></div>
        {isEnabled('staff_accounts') && <div className="rounded-lg bg-slate-950 p-2"><StaffSwitcher value={staffSession} onChange={setStaffSession} permission="can_adjust_stock" purpose="managing procurement" /></div>}
      </header>

      {loadError && <Card className="p-4"><p role="alert" className="text-danger">{loadError}</p><Button variant="outline" onClick={() => void loadCore().catch(() => undefined)}>Retry loading</Button></Card>}
      {isEnabled('staff_accounts') && <p className="text-sm text-ink-muted">Purchasing and receiving require the staff stock-adjustment permission. Pricing new medicines also requires the price-change permission.</p>}
      <Tabs defaultValue="suppliers" value={tab} onValueChange={value => { setTab(value); if (value === 'trace') loadTrace() }}>
        <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-5">
          <TabsTrigger value="suppliers"><UserRoundPlus className="mr-2 h-4 w-4" />Suppliers</TabsTrigger>
          <TabsTrigger value="orders"><ClipboardList className="mr-2 h-4 w-4" />Purchase orders</TabsTrigger>
          <TabsTrigger value="receiving"><PackageCheck className="mr-2 h-4 w-4" />Receive stock</TabsTrigger>
          <TabsTrigger value="receipts">Receipt history</TabsTrigger>
          <TabsTrigger value="trace"><ArchiveRestore className="mr-2 h-4 w-4" />Batch trace</TabsTrigger>
        </TabsList>

        <TabsContent value="suppliers" className="space-y-5">
          <Card className="p-4 sm:p-6"><h2 className="mb-4 text-lg font-semibold">Add supplier</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input placeholder="Supplier name *" value={supplierForm.name} onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })} />
              <Input placeholder="Contact person" value={supplierForm.contact_person} onChange={e => setSupplierForm({ ...supplierForm, contact_person: e.target.value })} />
              <Input placeholder="Phone" value={supplierForm.phone} onChange={e => setSupplierForm({ ...supplierForm, phone: e.target.value })} />
              <Input type="email" placeholder="Email" value={supplierForm.email} onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })} />
              <Input placeholder="Address" value={supplierForm.address} onChange={e => setSupplierForm({ ...supplierForm, address: e.target.value })} />
              <Input placeholder="Payment terms" value={supplierForm.payment_terms} onChange={e => setSupplierForm({ ...supplierForm, payment_terms: e.target.value })} />
              <Input placeholder="Notes" value={supplierForm.notes} onChange={e => setSupplierForm({ ...supplierForm, notes: e.target.value })} />
              <Button onClick={createSupplier} disabled={busy || !supplierForm.name.trim()}><Plus className="mr-2 h-4 w-4" />Add supplier</Button>
            </div>
          </Card>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{suppliers.map(supplier => (
            <Card key={supplier.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{supplier.name}</h3><p className="text-sm text-ink-muted">{supplier.contact_person || 'No contact person'}</p></div><span className={`text-xs font-medium ${supplier.is_active ? 'text-success' : 'text-ink-muted'}`}>{supplier.is_active ? 'Active' : 'Inactive'}</span></div>
              <div className="mt-3 space-y-1 text-sm text-ink-muted"><p>{supplier.phone || 'No phone'}</p><p>{supplier.email || 'No email'}</p><p>{supplier.payment_terms || 'No payment terms'}</p></div>
              <Button className="mt-4" variant="ghost" size="sm" onClick={() => api({ action: 'supplier_update', id: supplier.id, is_active: !supplier.is_active }).then(loadCore).catch(error => toast.error(error.message))}>{supplier.is_active ? 'Deactivate' : 'Reactivate'}</Button>
            </Card>
          ))}</div>
        </TabsContent>

        <TabsContent value="orders" className="space-y-5">
          <Card className="p-4 sm:p-6"><h2 className="mb-4 text-lg font-semibold">{editingPO ? 'Edit draft purchase order' : 'Create purchase order'}</h2>
            <div className="grid gap-3 md:grid-cols-3"><Select value={poSupplier} onChange={e => setPoSupplier(e.target.value)}><option value="">Select supplier *</option>{suppliers.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select><Input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} /><Input placeholder="PO notes" value={poNotes} onChange={e => setPoNotes(e.target.value)} /></div>
            <ProcurementProductPicker onSelect={addDraftLine} disabled={busy} />
            <p className="mt-3 text-xs text-ink-muted">Order quantities and costs are per inventory base unit (for example one tablet or one bottle). Pack conversions are captured during receiving.</p>

            <div className="mt-4 space-y-2">{draftLines.map((line, index) => <div key={line.product.id} className="grid gap-2 border-b border-border py-3 sm:grid-cols-[1fr_110px_140px_40px] sm:items-center"><div className="text-sm font-medium">{productLabel(line.product)}</div><Input aria-label="Quantity ordered in base units" type="number" min={1} value={line.quantity_ordered} onChange={e => setDraftLines(lines => lines.map((item, i) => i === index ? { ...item, quantity_ordered: Number(e.target.value) } : item))} /><Input aria-label="Cost per base unit" type="number" min={0} step="0.01" value={line.unit_cost} onChange={e => setDraftLines(lines => lines.map((item, i) => i === index ? { ...item, unit_cost: Number(e.target.value) } : item))} /><Button size="icon" variant="ghost" onClick={() => setDraftLines(lines => lines.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button></div>)}</div>
            <div className="mt-4 flex justify-end"><Button onClick={createPO} disabled={busy || !poSupplier || !draftLines.length || draftLines.some(line => !Number.isInteger(line.quantity_ordered) || line.quantity_ordered < 1 || line.unit_cost < 0)}>{editingPO ? 'Save draft changes' : 'Create draft PO'}</Button>{editingPO && <Button variant="outline" onClick={() => { setEditingPO(null); setDraftLines([]); setPoNotes(''); setExpectedDate('') }}>Cancel editing</Button>}</div>
          </Card>
          <div className="space-y-3">{orders.map(order => <Card key={order.id} className="p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{order.po_number}</h3><span className="rounded-badge bg-surface px-2 py-1 text-xs capitalize text-ink-muted">{order.status.replace('_', ' ')}</span></div><p className="mt-1 text-sm text-ink-muted">{order.suppliers.name} · {order.purchase_order_items.length} lines · Ordered: {money(order.subtotal)} · Received: {money(order.received_total || 0)}</p></div><div className="flex flex-wrap gap-2">{order.status === 'draft' && <Button size="sm" variant="outline" onClick={() => editOrder(order)}>Edit draft</Button>}{['draft','sent'].includes(order.status) && <Button disabled={busy} size="sm" variant="outline" onClick={() => { if (window.confirm(`Cancel ${order.po_number}?`)) void updatePOStatus(order.id,'cancelled') }}>Cancel order</Button>}{order.status === 'draft' && <Button size="sm" onClick={() => updatePOStatus(order.id, 'sent')}><Send className="mr-2 h-4 w-4" />Mark sent</Button>}<Button size="sm" variant="outline" onClick={() => sharePO(order)}><Share2 className="mr-2 h-4 w-4" />Share</Button>{openOrders.some(item => item.id === order.id) && <Button size="sm" variant="outline" onClick={() => { setTab('receiving'); setReceiveMode('po'); selectPOForReceipt(order.id) }}><PackageCheck className="mr-2 h-4 w-4" />Receive</Button>}</div></div></Card>)}</div>
        </TabsContent>

        <TabsContent value="receiving" className="space-y-5">
          <Card className="p-4 sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold">Goods receiving</h2><p className="text-sm text-ink-muted">Batch and expiry are captured only for items configured to track them.</p></div><div className="flex rounded-input border border-border p-1"><Button size="sm" variant={receiveMode === 'po' ? 'default' : 'ghost'} onClick={() => { setReceiveMode('po'); setReceivingLines([]) }}>Against PO</Button><Button size="sm" variant={receiveMode === 'direct' ? 'default' : 'ghost'} onClick={() => { setReceiveMode('direct'); setReceivePO(''); setReceivingLines([]) }}>Direct purchase</Button></div></div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">{receiveMode === 'po' ? <Select aria-label="Purchase order to receive" value={receivePO} onChange={e => selectPOForReceipt(e.target.value)}><option value="">Select open purchase order</option>{openOrders.map(order => <option key={order.id} value={order.id}>{order.po_number} · {order.suppliers.name}</option>)}</Select> : <Select aria-label="Receiving supplier" value={receiveSupplier} onChange={e => setReceiveSupplier(e.target.value)}><option value="">Select supplier *</option>{suppliers.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</div>
            {receiveMode === 'direct' && <ProcurementProductPicker onSelect={addDirectLine} disabled={busy} />}
            <p className="mt-3 text-sm text-ink-muted">Enter only what arrived. Leave undelivered order lines at zero. Add a separate line for each batch.</p>

            {receiveMode === 'po' && receivePO && <div className="mt-3 flex gap-2"><Input value={scanValue} onChange={e => setScanValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') jumpByBarcode() }} placeholder="Scan barcode to jump to PO line" /><Button variant="outline" size="icon" onClick={jumpByBarcode}><Search className="h-4 w-4" /></Button></div>}
          </Card>
          <div className="space-y-3">{receivingLines.map((line, index) => {
            const short = line.product.tracks_expiry && isShortDated(line.expiry_date)
            return <Card id={`receive-line-${index}`} key={`${line.product.id}-${index}`} className="p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{productLabel(line.product)}</h3><p className="text-xs text-ink-muted">{line.remaining === undefined ? 'Direct purchase' : `${line.remaining} base units outstanding on order`}</p></div>
                <div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => setReceivingLines(lines => [...lines, { ...line, quantity_received: 0, batch_number: '', expiry_date: '', short_dated_confirmed: false }])}>Split / add batch</Button><Button aria-label="Remove receiving line" size="icon" variant="ghost" onClick={() => setReceivingLines(lines => lines.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1 text-xs text-ink-muted">Receiving unit<Select aria-label="Receiving unit" value={line.receiving_unit} onChange={e => updateReceivingLine(index, { receiving_unit: e.target.value as 'base' | 'pack', units_per_pack: 1 })}><option value="base">Base units</option><option value="pack">Packs / cartons</option></Select></label>
                <label className="space-y-1 text-xs text-ink-muted">Quantity received<Input type="number" min={0} step={1} value={line.quantity_received} onChange={e => updateReceivingLine(index, { quantity_received: Number(e.target.value) })} /></label>
                {line.receiving_unit === 'pack' && <label className="space-y-1 text-xs text-ink-muted">Base units in each pack<Input type="number" min={1} step={1} value={line.units_per_pack} onChange={e => updateReceivingLine(index, { units_per_pack: Number(e.target.value) })} /></label>}
                <label className="space-y-1 text-xs text-ink-muted">Cost per {line.receiving_unit === 'pack' ? 'pack' : 'base unit'} (₦)<Input type="number" min={0} step="0.01" value={line.unit_cost} onChange={e => updateReceivingLine(index, { unit_cost: Number(e.target.value) })} /></label>
                {line.product.tracks_expiry && <><label className="space-y-1 text-xs text-ink-muted">Batch number<Input value={line.batch_number} onChange={e => updateReceivingLine(index, { batch_number: e.target.value })} /></label><label className="space-y-1 text-xs text-ink-muted">Expiry date<Input type="date" value={line.expiry_date} onChange={e => updateReceivingLine(index, { expiry_date: e.target.value, short_dated_confirmed: false })} /></label></>}
                {line.product.target_type === 'medicine' && <label className="space-y-1 text-xs text-ink-muted">Base unit name (new medicine only)<Input value={line.base_unit_name} maxLength={40} onChange={event => updateReceivingLine(index, { base_unit_name: event.target.value })} placeholder="tablet, bottle, capsule…" /></label>}
                {line.product.target_type === 'medicine' && <label className="space-y-1 text-xs text-ink-muted">Selling price per base unit (new medicine only)<Input type="number" min="0.01" step="0.01" value={line.selling_price} onChange={e => updateReceivingLine(index, { selling_price: e.target.value })} placeholder="Required for new medicines" /></label>}
              </div>
              <p className="mt-3 text-sm font-medium">Adds {receivingBaseQuantity(line)} base units · {money(line.quantity_received * line.unit_cost)} purchase total</p>
              <p className="mt-1 text-xs text-ink-muted">Current base unit: {line.base_unit_name}. A base unit is the inventory selling unit, such as one tablet or one bottle. Existing selling prices are preserved.</p>
              {line.product.deleted_at && <p className="mt-3 text-sm text-amber-800">This item is in the recovery bin. Restoration keeps its existing stock and history.</p>}
              <label className="mt-3 flex items-center gap-2 text-sm"><Checkbox checked={line.restore_deleted} onCheckedChange={checked => updateReceivingLine(index, { restore_deleted: checked === true })} />Restore this item if removed (within its 60-day recovery window)</label>
              {short && line.quantity_received > 0 && <label className="mt-3 flex items-center gap-2 rounded border border-warning bg-warning/10 p-3 text-sm"><Checkbox checked={line.short_dated_confirmed} onCheckedChange={checked => updateReceivingLine(index, { short_dated_confirmed: checked === true })} />This batch expires in under four months. Accept it.</label>}
            </Card>
          })}</div>
          {receivingLines.length > 0 && <Card className="space-y-4 p-4"><label className="block text-sm">Supplier invoice / delivery reference (recommended)<Input value={invoiceReference} onChange={event => setInvoiceReference(event.target.value)} /></label><label className="block text-sm">Receipt notes<Textarea value={receiveNotes} onChange={event => setReceiveNotes(event.target.value)} /></label>
            <p className="font-semibold">{deliveredLines.length} delivered batch lines · {deliveredLines.reduce((total, line) => total + receivingBaseQuantity(line), 0)} base units · {money(receiptTotal)}</p>
            {invalidReceipt && <p className="text-sm text-amber-800">Complete the delivered lines, confirm short-dated batches, and keep combined quantities within the order remainder. New medicines need a selling price.</p>}<Button onClick={() => setConfirmReceive(true)} disabled={busy || invalidReceipt}>Review receipt</Button>
          </Card>}
          {confirmReceive && <Card className="space-y-3 border-primary p-5" role="region" aria-label="Confirm receipt">
            <h3 className="font-semibold">Confirm delivery into stock</h3><p>Supplier: {suppliers.find(item => item.id === receiveSupplier)?.name} · Reference: {invoiceReference || 'Not supplied'}</p>
            <ul className="space-y-2 text-sm">{deliveredLines.map((line, index) => <li key={index}>{productLabel(line.product)} — {receivingBaseQuantity(line)} base units{line.product.tracks_expiry ? ` · Batch ${line.batch_number} · Exp ${line.expiry_date}` : ''} · {money(line.quantity_received * line.unit_cost)}</li>)}</ul>
            <p className="font-semibold">Total purchase cost: {money(receiptTotal)}</p><p className="text-sm text-ink-muted">Check quantities, pack conversions and costs against the delivery before confirming.</p>
            <div className="flex gap-2"><Button disabled={busy || invalidReceipt} onClick={commitReceipt}>Confirm and receive stock</Button><Button variant="outline" disabled={busy} onClick={() => setConfirmReceive(false)}>Back to edit</Button></div>
          </Card>}

        </TabsContent>

        <TabsContent value="receipts" className="space-y-4">
          <h2 className="text-lg font-semibold">Receipt history</h2>
          {receipts.length === 0 && <Card className="p-5 text-sm">No receipts recorded yet.</Card>}
          {receipts.map(receipt => <Card key={receipt.id} className="space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{receipt.receipt_number} {receipt.reversed_at && '· Reversed'}</h3><p className="text-sm text-ink-muted">{receipt.suppliers.name} · {new Date(receipt.received_at).toLocaleString()} · {receipt.purchase_orders?.po_number || 'Direct purchase'}</p><p className="text-sm">Invoice: {receipt.invoice_reference || 'Not supplied'}</p></div>{!receipt.reversed_at && receipt.request_key && <Button variant="outline" size="sm" onClick={() => { setReverseReceipt(receipt); setReversalReason('') }}>Reverse receipt</Button>}</div>
            <ul className="space-y-1 text-sm">{receipt.goods_receipt_items.map(item => <li key={item.id}>{item.products ? `${item.products.brand_name || item.products.generic_name} ${item.products.strength || ''}` : item.pharmacy_inventory?.item_name} · {item.quantity_received} base units · {item.batches?.batch_number || 'No batch tracking'} · {money(item.line_total)}</li>)}</ul>
            <p className="font-semibold">Actual receipt total: {money(receipt.goods_receipt_items.reduce((total, item) => total + Number(item.line_total), 0))}</p>{receipt.reversed_at && <p className="text-sm">Reversal reason: {receipt.reversal_reason}</p>}
          </Card>)}
          <div className="flex justify-between"><Button variant="outline" disabled={receiptPage === 0 || busy} onClick={() => void changeReceiptPage(receiptPage - 1)}>Newer receipts</Button><Button variant="outline" disabled={!moreReceipts || busy} onClick={() => void changeReceiptPage(receiptPage + 1)}>Older receipts</Button></div>
          {reverseReceipt && <Card className="space-y-3 border-warning p-5"><h3 className="font-semibold">Reverse {reverseReceipt.receipt_number}?</h3><p className="text-sm">This removes its received quantities from stock and reopens its order quantities. History stays visible. Stock already sold, used or reserved cannot be reversed here.</p><label className="block text-sm">Reason<Textarea value={reversalReason} onChange={event => setReversalReason(event.target.value)} maxLength={300} /></label><Button disabled={busy || reversalReason.trim().length < 3} onClick={reverseDelivery}>Confirm reversal</Button><Button variant="outline" disabled={busy} onClick={() => setReverseReceipt(null)}>Keep receipt</Button></Card>}
        </TabsContent>

        <TabsContent value="trace" className="space-y-4">
          <Card className="p-4"><form className="flex gap-2" onSubmit={event => { event.preventDefault(); loadTrace((event.currentTarget.elements.namedItem('trace') as HTMLInputElement).value) }}><Input name="trace" placeholder="Search batch number" /><Button type="submit"><Search className="mr-2 h-4 w-4" />Trace</Button></form></Card>
          <div className="grid gap-3 lg:grid-cols-2">{traceRows.map(batch => { const inventory = batch.pharmacy_inventory; const product = inventory?.products; const label = product ? `${product.brand_name || product.generic_name} ${product.strength || ''}` : `${inventory?.brand || inventory?.item_name || 'Unknown item'} ${inventory?.unit_description || ''}`; return <Card key={batch.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{batch.batch_number}</h3><p className="text-sm text-ink-muted">{label.trim()}</p><p className="text-xs font-medium text-primary capitalize">{inventory?.item_type}</p></div><span className="text-sm font-medium">Exp {new Date(batch.expiry_date).toLocaleDateString()}</span></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-ink-muted">Supplier</dt><dd>{batch.suppliers?.name || 'Legacy stock'}</dd></div><div><dt className="text-ink-muted">Purchase order</dt><dd>{batch.purchase_orders?.po_number || 'Direct / legacy'}</dd></div><div><dt className="text-ink-muted">Received</dt><dd>{batch.quantity_received} units</dd></div><div><dt className="text-ink-muted">Affected sales</dt><dd>{batch.sale_items?.length || 0}</dd></div></dl></Card> })}</div>
        </TabsContent>
      </Tabs>
      <SpAuthorizationModal open={authorization !== null} action={authorization?.action || 'stock_adjustment'} description="Authorize this procurement action"
        onClose={() => setAuthorization(null)} onAuthorized={async () => {
          if (!authorization) return
          const pending = authorization; setAuthorization(null); setBusy(true)
          try {
            const result = await pending.retry()
            if (result.receipt_number) await finishReceipt({ ...result, receipt_number: result.receipt_number })
            else { setReverseReceipt(null); await loadCore(); toast.success('Procurement action completed') }
          } catch (error) { toast.error(error instanceof Error ? error.message : 'Procurement action failed') }
          finally { setBusy(false) }
        }} />
    </div>
  )
}
