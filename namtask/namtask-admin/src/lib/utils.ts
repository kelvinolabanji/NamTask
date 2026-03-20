import { format, formatDistanceToNow } from 'date-fns'
import clsx, { ClassValue } from 'clsx'

export const cn = (...inputs: ClassValue[]) => clsx(inputs)

export const fmt = {
  date:     (d: string | Date) => format(new Date(d), 'dd MMM yyyy'),
  datetime: (d: string | Date) => format(new Date(d), 'dd MMM yyyy, HH:mm'),
  ago:      (d: string | Date) => formatDistanceToNow(new Date(d), { addSuffix: true }),
  money:    (n: number | string) => `NAD ${parseFloat(String(n ?? 0)).toLocaleString('en-NA', { minimumFractionDigits: 2 })}`,
  percent:  (n: number) => `${(n * 100).toFixed(1)}%`,
  number:   (n: number | string) => parseInt(String(n ?? 0)).toLocaleString(),
}

export const STATUS_COLORS: Record<string, string> = {
  // Task statuses
  pending:     'badge-yellow',
  accepted:    'badge-blue',
  in_progress: 'badge-purple',
  completed:   'badge-green',
  cancelled:   'badge-gray',
  disputed:    'badge-red',
  // KYC
  approved:    'badge-green',
  rejected:    'badge-red',
  in_review:   'badge-blue',
  // Dispute
  open:         'badge-red',
  under_review: 'badge-yellow',
  resolved:     'badge-green',
  closed:       'badge-gray',
  // Payment
  failed:       'badge-red',
  refunded:     'badge-blue',
  processing:   'badge-yellow',
  held:         'badge-yellow',
  released:     'badge-green',
}

export const TX_ICONS: Record<string, string> = {
  deposit: '↓', withdrawal: '↑', escrow_hold: '🔒',
  escrow_release: '🔓', payout: '💸', commission: '✂️', refund: '↩️',
}
