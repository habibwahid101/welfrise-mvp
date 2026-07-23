export const SLOT_PRICE_USD = 10
export const ALLOWED_SLOT_COUNTS = [1, 2, 5, 10] as const

export type AllowedSlotCount = (typeof ALLOWED_SLOT_COUNTS)[number]

export function calculatePaymentPackage(value: unknown) {
  if (typeof value !== 'number') return null
  const slots = value
  if (!Number.isInteger(slots) || !ALLOWED_SLOT_COUNTS.some((allowed) => allowed === slots)) return null

  return {
    slots: slots as AllowedSlotCount,
    amount: slots * SLOT_PRICE_USD,
  }
}
