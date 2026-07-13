import type { LocalSale } from '@/lib/db/pos-local-db'

export function calculateShiftSales(sales: LocalSale[], shiftId: string) {
  const completed = sales.filter((sale) => sale.shift_id === shiftId && sale.status === 'completed')
  const totalFor = (method: LocalSale['payment_method']) => completed
    .filter((sale) => sale.payment_method === method)
    .reduce((sum, sale) => sum + Number(sale.total), 0)
  return {
    transactionCount: completed.length,
    itemCount: completed.reduce((sum, sale) => sum + sale.items.reduce((count, item) => count + item.quantity, 0), 0),
    totalSales: completed.reduce((sum, sale) => sum + Number(sale.total), 0),
    cashSales: totalFor('cash'),
    bankTransferSales: totalFor('bank_transfer'),
    terminalSales: totalFor('pharmacy_pos_terminal'),
    otherSales: totalFor('other'),
  }
}

export function reconcileCash(openingFloat: number, cashSales: number, countedCash: number) {
  const expectedCash = openingFloat + cashSales
  return { expectedCash, variance: countedCash - expectedCash }
}
