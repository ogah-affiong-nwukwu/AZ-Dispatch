export function formatNgn(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`
}

export function formatNgnExact(amount: number): string {
  return `₦${amount.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatEta(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const diffDays = Math.round(
    (startOfDay(date) - startOfDay(now)) / 86_400_000,
  )
  const time = date.toLocaleTimeString('en-NG', {
    hour: 'numeric',
    minute: '2-digit',
  })
  if (diffDays === 0) return `Today, ${time}`
  if (diffDays === 1) return `Tomorrow, ${time}`
  if (diffDays === -1) return `Yesterday, ${time}`
  const day = date.toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
  })
  return `${day}, ${time}`
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function isSameLocalDay(iso: string, date: Date): boolean {
  const target = new Date(iso)
  return (
    target.getFullYear() === date.getFullYear() &&
    target.getMonth() === date.getMonth() &&
    target.getDate() === date.getDate()
  )
}
