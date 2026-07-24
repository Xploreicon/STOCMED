'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
type Product = {
  id: string; generic_name: string; brand_name: string | null; strength: string
  dosage_form: string | null; pack_size: string | null; barcode: string | null
  target_type: 'medicine' | 'store'; product_id: string | null; inventory_id: string | null
  tracks_expiry: boolean
}
type POItem = {
  id: string; product_id: string | null; inventory_id: string | null
  quantity_ordered: number; quantity_received: number
  unit_cost: number; line_total: number; products: Product | null
  pharmacy_inventory: {
    id: string; item_name: string; brand: string | null; barcode: string | null
    unit_description: string | null; store_category: string | null; tracks_expiry: boolean
  } | null
}
type PurchaseOrder = {
  id: string; supplier_id: string; po_number: string; status: string; expected_date: string | null
  subtotal: number; notes: string | null; created_at: string; suppliers: Supplier
  purchase_order_items: POItem[]
}
type DraftLine = { product: Product; quantity_ordered: number; unit_cost: number }
type ReceivingLine = {
  po_item_id: string | null; product_id: string | null; inventory_id: string | null; product: Product
  quantity_received: number; batch_number: string; expiry_date: string
  unit_cost: number; short_dated_confirmed: boolean
}

const money = (value: number) => `₦${Number(value || 0).toLocaleString()}`
const productLabel = (product: Product) =>
  `${product.brand_name ? `${product.brand_name} · ` : ''}${product.generic_name} ${product.strength || ''}`.trim()

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
    }

async function api(body: Record<string, unknown>) {
  const response = await fetch('/api/pharmacy/procurement', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Request failed')
  return data
}

export default function ProcurementPage() {
  const [tab, setTab] = useState('suppliers')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [traceRows, setTraceRows] = useState<any[]>([])
  const [busy, setBusy] = useState(false)

  const loadCore = useCallback(async () => {
    const [supplierRes, productRes, orderRes] = await Promise.all([
      fetch('/api/pharmacy/procurement?view=suppliers').then(r => r.json()),
      fetch('/api/pharmacy/procurement?view=products').then(r => r.json()),
      fetch('/api/pharmacy/procurement?view=orders').then(r => r.json()),
    ])
    setSuppliers(supplierRes.suppliers || [])
    setProducts(productRes.products || [])
    setOrders(orderRes.orders || [])
  }, [])

  useEffect(() => { loadCore().catch(() => toast.error('Could not load procurement data')) }, [loadCore])

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
  const [productToAdd, setProductToAdd] = useState('')
  const [draftLines, setDraftLines] = useState<DraftLine[]>([])
  const addDraftLine = () => {
    const product = products.find(item => item.id === productToAdd)
    if (!product || draftLines.some(line => line.product.id === product.id)) return
    setDraftLines(lines => [...lines, { product, quantity_ordered: 1, unit_cost: 0 }])
    setProductToAdd('')
  }
  const createPO = async () => {
    setBusy(true)
    try {
      await api({
        action: 'po_create', supplier_id: poSupplier, expected_date: expectedDate || null,
        notes: poNotes, items: draftLines.map(line => ({
          product_id: line.product.product_id,
          inventory_id: line.product.inventory_id,
          quantity_ordered: line.quantity_ordered,
          unit_cost: line.unit_cost,
        })),
      })
      setDraftLines([]); setPoNotes(''); setExpectedDate(''); await loadCore()
      toast.success('Draft purchase order created')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create PO') }
    finally { setBusy(false) }
  }
  const updatePOStatus = async (id: string, status: 'sent' | 'cancelled') => {
    try { await api({ action: 'po_status', id, status }); await loadCore(); toast.success(`PO marked ${status}`) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update PO') }
  }
  const sharePO = async (order: PurchaseOrder) => {
    const lines = order.purchase_order_items.map(item =>
      `${productLabel(poItemProduct(item))} × ${item.quantity_ordered} @ ${money(item.unit_cost)}`
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
        quantity_received: item.quantity_ordered - item.quantity_received,
        batch_number: '', expiry_date: '', unit_cost: Number(item.unit_cost), short_dated_confirmed: false,
      }}))
  }
  const addDirectLine = () => {
    const product = products.find(item => item.id === productToAdd)
    if (!product || receivingLines.some(line => line.product.id === product.id)) return
    setReceivingLines(lines => [...lines, {
      po_item_id: null, product_id: product.product_id, inventory_id: product.inventory_id,
      product, quantity_received: 1,
      batch_number: '', expiry_date: '', unit_cost: 0, short_dated_confirmed: false,
    }]); setProductToAdd('')
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
  const commitReceipt = async () => {
    if (receivingLines.some(line => line.product.tracks_expiry && isShortDated(line.expiry_date) && !line.short_dated_confirmed)) {
      return toast.error('Confirm every short-dated batch before receiving')
    }
    setBusy(true)
    try {
      const result = await api({
        action: 'receive', supplier_id: receiveSupplier, po_id: receiveMode === 'po' ? receivePO : null,
        notes: receiveNotes, lines: receivingLines.map(({ product, ...line }) => line),
      })
      toast.success(`${result.receipt_number} received and added to stock`)
      setReceivingLines([]); setReceivePO(''); setReceiveNotes(''); await loadCore()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Receiving failed') }
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
        <div className="flex items-center gap-2 text-sm text-ink-muted"><Truck className="h-4 w-4" /> Stock enters the ledger only through receiving</div>
      </header>

      <Tabs defaultValue="suppliers" value={tab} onValueChange={value => { setTab(value); if (value === 'trace') loadTrace() }}>
        <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="suppliers"><UserRoundPlus className="mr-2 h-4 w-4" />Suppliers</TabsTrigger>
          <TabsTrigger value="orders"><ClipboardList className="mr-2 h-4 w-4" />Purchase orders</TabsTrigger>
          <TabsTrigger value="receiving"><PackageCheck className="mr-2 h-4 w-4" />Receive stock</TabsTrigger>
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
              <Button className="mt-4" variant="ghost" size="sm" onClick={() => api({ action: 'supplier_update', id: supplier.id, is_active: !supplier.is_active }).then(loadCore)}>{supplier.is_active ? 'Deactivate' : 'Reactivate'}</Button>
            </Card>
          ))}</div>
        </TabsContent>

        <TabsContent value="orders" className="space-y-5">
          <Card className="p-4 sm:p-6"><h2 className="mb-4 text-lg font-semibold">Create purchase order</h2>
            <div className="grid gap-3 md:grid-cols-3"><Select value={poSupplier} onChange={e => setPoSupplier(e.target.value)}><option value="">Select supplier *</option>{suppliers.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select><Input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} /><Input placeholder="PO notes" value={poNotes} onChange={e => setPoNotes(e.target.value)} /></div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row"><Select className="min-w-0 flex-1" value={productToAdd} onChange={e => setProductToAdd(e.target.value)}><option value="">Add medicine or store item</option>{products.map(p => <option key={p.id} value={p.id}>[{p.target_type === 'medicine' ? 'Rx' : 'Store'}] {productLabel(p)}</option>)}</Select><Button variant="outline" onClick={addDraftLine}><Plus className="mr-2 h-4 w-4" />Add line</Button></div>
            <div className="mt-4 space-y-2">{draftLines.map((line, index) => <div key={line.product.id} className="grid gap-2 border-b border-border py-3 sm:grid-cols-[1fr_110px_140px_40px] sm:items-center"><div className="text-sm font-medium">{productLabel(line.product)}</div><Input type="number" min={1} value={line.quantity_ordered} onChange={e => setDraftLines(lines => lines.map((item, i) => i === index ? { ...item, quantity_ordered: Number(e.target.value) } : item))} /><Input type="number" min={0} step="0.01" value={line.unit_cost} onChange={e => setDraftLines(lines => lines.map((item, i) => i === index ? { ...item, unit_cost: Number(e.target.value) } : item))} /><Button size="icon" variant="ghost" onClick={() => setDraftLines(lines => lines.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button></div>)}</div>
            <div className="mt-4 flex justify-end"><Button onClick={createPO} disabled={busy || !poSupplier || !draftLines.length}>Create draft PO</Button></div>
          </Card>
          <div className="space-y-3">{orders.map(order => <Card key={order.id} className="p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{order.po_number}</h3><span className="rounded-badge bg-surface px-2 py-1 text-xs capitalize text-ink-muted">{order.status.replace('_', ' ')}</span></div><p className="mt-1 text-sm text-ink-muted">{order.suppliers.name} · {order.purchase_order_items.length} lines · {money(order.subtotal)}</p></div><div className="flex flex-wrap gap-2">{order.status === 'draft' && <Button size="sm" onClick={() => updatePOStatus(order.id, 'sent')}><Send className="mr-2 h-4 w-4" />Mark sent</Button>}<Button size="sm" variant="outline" onClick={() => sharePO(order)}><Share2 className="mr-2 h-4 w-4" />Share</Button>{openOrders.some(item => item.id === order.id) && <Button size="sm" variant="outline" onClick={() => { setTab('receiving'); setReceiveMode('po'); selectPOForReceipt(order.id) }}><PackageCheck className="mr-2 h-4 w-4" />Receive</Button>}</div></div></Card>)}</div>
        </TabsContent>

        <TabsContent value="receiving" className="space-y-5">
          <Card className="p-4 sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold">Goods receiving</h2><p className="text-sm text-ink-muted">Batch and expiry are captured only for items configured to track them.</p></div><div className="flex rounded-input border border-border p-1"><Button size="sm" variant={receiveMode === 'po' ? 'default' : 'ghost'} onClick={() => { setReceiveMode('po'); setReceivingLines([]) }}>Against PO</Button><Button size="sm" variant={receiveMode === 'direct' ? 'default' : 'ghost'} onClick={() => { setReceiveMode('direct'); setReceivePO(''); setReceivingLines([]) }}>Direct purchase</Button></div></div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">{receiveMode === 'po' ? <Select value={receivePO} onChange={e => selectPOForReceipt(e.target.value)}><option value="">Select open purchase order</option>{openOrders.map(order => <option key={order.id} value={order.id}>{order.po_number} · {order.suppliers.name}</option>)}</Select> : <><Select value={receiveSupplier} onChange={e => setReceiveSupplier(e.target.value)}><option value="">Select supplier *</option>{suppliers.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select><div className="flex gap-2"><Select className="min-w-0 flex-1" value={productToAdd} onChange={e => setProductToAdd(e.target.value)}><option value="">Medicine or store item</option>{products.map(p => <option key={p.id} value={p.id}>[{p.target_type === 'medicine' ? 'Rx' : 'Store'}] {productLabel(p)}</option>)}</Select><Button size="icon" onClick={addDirectLine}><Plus className="h-4 w-4" /></Button></div></>}</div>
            {receiveMode === 'po' && receivePO && <div className="mt-3 flex gap-2"><Input value={scanValue} onChange={e => setScanValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') jumpByBarcode() }} placeholder="Scan barcode to jump to PO line" /><Button variant="outline" size="icon" onClick={jumpByBarcode}><Search className="h-4 w-4" /></Button></div>}
          </Card>
          <div className="space-y-3">{receivingLines.map((line, index) => { const short = line.product.tracks_expiry && isShortDated(line.expiry_date); return <Card id={`receive-line-${index}`} key={`${line.product.id}-${index}`} className="p-4"><div className="mb-3 flex items-start justify-between gap-3"><div><h3 className="font-semibold">{productLabel(line.product)}</h3><p className="text-xs font-medium text-primary">{line.product.target_type === 'medicine' ? 'Medicine' : 'Store'}{line.product.barcode ? ` · Barcode ${line.product.barcode}` : ''}</p></div>{receiveMode === 'direct' && <Button size="icon" variant="ghost" onClick={() => setReceivingLines(lines => lines.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button>}</div><div className={`grid gap-3 sm:grid-cols-2 ${line.product.tracks_expiry ? 'lg:grid-cols-4' : 'lg:grid-cols-2'}`}><label className="space-y-1 text-xs text-ink-muted">Quantity received<Input type="number" min={1} value={line.quantity_received} onChange={e => updateReceivingLine(index, { quantity_received: Number(e.target.value) })} /></label>{line.product.tracks_expiry && <><label className="space-y-1 text-xs text-ink-muted">Batch number<Input value={line.batch_number} onChange={e => updateReceivingLine(index, { batch_number: e.target.value })} /></label><label className="space-y-1 text-xs text-ink-muted">Expiry date<Input type="date" value={line.expiry_date} onChange={e => updateReceivingLine(index, { expiry_date: e.target.value, short_dated_confirmed: false })} /></label></>}<label className="space-y-1 text-xs text-ink-muted">Unit cost<Input type="number" min={0} step="0.01" value={line.unit_cost} onChange={e => updateReceivingLine(index, { unit_cost: Number(e.target.value) })} /></label></div>{short && <label className="mt-3 flex items-center gap-2 rounded-input border border-warning bg-warning/10 p-3 text-sm text-ink"><Checkbox checked={line.short_dated_confirmed} onCheckedChange={checked => updateReceivingLine(index, { short_dated_confirmed: checked === true })} />This batch expires in under four months. Accept it.</label>}</Card> })}</div>
          {receivingLines.length > 0 && <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end"><div className="flex-1"><label className="text-xs text-ink-muted">Receipt notes</label><Textarea value={receiveNotes} onChange={e => setReceiveNotes(e.target.value)} /></div><Button onClick={commitReceipt} disabled={busy || !receiveSupplier || receivingLines.some(line => (line.product.tracks_expiry && (!line.batch_number || !line.expiry_date)) || line.quantity_received <= 0)}><Check className="mr-2 h-4 w-4" />Receive into stock</Button></Card>}
        </TabsContent>

        <TabsContent value="trace" className="space-y-4">
          <Card className="p-4"><form className="flex gap-2" onSubmit={event => { event.preventDefault(); loadTrace((event.currentTarget.elements.namedItem('trace') as HTMLInputElement).value) }}><Input name="trace" placeholder="Search batch number" /><Button type="submit"><Search className="mr-2 h-4 w-4" />Trace</Button></form></Card>
          <div className="grid gap-3 lg:grid-cols-2">{traceRows.map(batch => { const inventory = batch.pharmacy_inventory; const product = inventory?.products; const label = product ? `${product.brand_name || product.generic_name} ${product.strength || ''}` : `${inventory?.brand || inventory?.item_name || 'Unknown item'} ${inventory?.unit_description || ''}`; return <Card key={batch.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{batch.batch_number}</h3><p className="text-sm text-ink-muted">{label.trim()}</p><p className="text-xs font-medium text-primary capitalize">{inventory?.item_type}</p></div><span className="text-sm font-medium">Exp {new Date(batch.expiry_date).toLocaleDateString()}</span></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-ink-muted">Supplier</dt><dd>{batch.suppliers?.name || 'Legacy stock'}</dd></div><div><dt className="text-ink-muted">Purchase order</dt><dd>{batch.purchase_orders?.po_number || 'Direct / legacy'}</dd></div><div><dt className="text-ink-muted">Received</dt><dd>{batch.quantity_received} units</dd></div><div><dt className="text-ink-muted">Affected sales</dt><dd>{batch.sale_items?.length || 0}</dd></div></dl></Card> })}</div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
