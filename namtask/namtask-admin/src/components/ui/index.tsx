import React, { ReactNode } from 'react'
import { STATUS_COLORS, cn } from '../../lib/utils'
import { X, ChevronLeft, ChevronRight, Loader2, InboxIcon } from 'lucide-react'

// ── StatCard ──────────────────────────────────────────────────────────────────
export function StatCard({
  label, value, sub, icon: Icon, color = 'teal', trend,
}: {
  label: string; value: string | number; sub?: string;
  icon?: React.ElementType; color?: 'teal' | 'gold' | 'green' | 'red' | 'blue';
  trend?: { value: number; label: string };
}) {
  const colors = {
    teal:  'bg-teal-50 text-teal-700 border-teal-200',
    gold:  'bg-yellow-50 text-yellow-700 border-yellow-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    red:   'bg-red-50 text-red-700 border-red-200',
    blue:  'bg-blue-50 text-blue-700 border-blue-200',
  }
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-navy-500">{label}</p>
          <p className="text-2xl font-extrabold text-navy-900 mt-1">{value}</p>
          {sub  && <p className="text-xs text-navy-400 mt-0.5">{sub}</p>}
          {trend && (
            <p className={cn('text-xs font-semibold mt-2', trend.value >= 0 ? 'text-green-600' : 'text-red-500')}>
              {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}% {trend.label}
            </p>
          )}
        </div>
        {Icon && (
          <div className={cn('p-2.5 rounded-xl border', colors[color])}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────
export function Badge({ status, label }: { status?: string; label?: string }) {
  const cls = STATUS_COLORS[status ?? ''] ?? 'badge-gray'
  return <span className={cls}>{label ?? status?.replace(/_/g, ' ')}</span>
}

// ── Avatar ────────────────────────────────────────────────────────────────────
export function Avatar({ name, url, size = 8 }: { name?: string; url?: string; size?: number }) {
  const initials = name?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() ?? '?'
  const sz = `w-${size} h-${size}`
  if (url) return <img src={url} alt={name} className={cn(sz, 'rounded-full object-cover bg-navy-100')} />
  return (
    <div className={cn(sz, 'rounded-full bg-teal-600 flex items-center justify-center text-white font-bold shrink-0')}
      style={{ fontSize: size * 1.8 }}>
      {initials}
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('w-5 h-5 animate-spin text-teal-600', className)} />
}

// ── PageLoader ────────────────────────────────────────────────────────────────
export function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <Spinner className="w-8 h-8" />
    </div>
  )
}

// ── EmptyState ────────────────────────────────────────────────────────────────
export function EmptyState({ message = 'No data found' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-navy-400">
      <InboxIcon className="w-12 h-12 mb-3 opacity-30" />
      <p className="text-sm font-medium">{message}</p>
    </div>
  )
}

// ── Pagination ────────────────────────────────────────────────────────────────
export function Pagination({
  page, limit, total, onChange,
}: { page: number; limit: number; total: number; onChange: (p: number) => void }) {
  const pages  = Math.ceil(total / limit)
  const from   = (page - 1) * limit + 1
  const to     = Math.min(page * limit, total)
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-navy-100">
      <p className="text-xs text-navy-500">{from}–{to} of {total.toLocaleString()}</p>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(page - 1)} disabled={page <= 1}
          className="p-1.5 rounded-lg hover:bg-navy-100 disabled:opacity-30 text-navy-500 transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
          const p = i + 1
          return (
            <button key={p} onClick={() => onChange(p)}
              className={cn('w-7 h-7 rounded-lg text-xs font-semibold transition-colors',
                p === page ? 'bg-teal-600 text-white' : 'text-navy-600 hover:bg-navy-100')}>
              {p}
            </button>
          )
        })}
        <button onClick={() => onChange(page + 1)} disabled={page >= pages}
          className="p-1.5 rounded-lg hover:bg-navy-100 disabled:opacity-30 text-navy-500 transition-colors">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({
  open, onClose, title, children, width = 'max-w-lg',
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className={cn('relative bg-white rounded-2xl shadow-2xl w-full', width)}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-navy-100">
          <h2 className="font-bold text-navy-900 text-lg">{title}</h2>
          <button onClick={onClose} className="p-1 text-navy-400 hover:text-navy-900 hover:bg-navy-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

// ── Table ─────────────────────────────────────────────────────────────────────
export function Table({ headers, children, loading, empty }: {
  headers: string[]; children: ReactNode; loading?: boolean; empty?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-navy-50 border-b border-navy-100">
            {headers.map(h => <th key={h} className="th">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={headers.length} className="text-center py-16"><Spinner className="inline" /></td></tr>
          ) : empty ? (
            <tr><td colSpan={headers.length}><EmptyState /></td></tr>
          ) : children}
        </tbody>
      </table>
    </div>
  )
}

// ── SearchInput ───────────────────────────────────────────────────────────────
export function SearchInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder ?? 'Search…'}
      className="input max-w-xs"
    />
  )
}

// ── Select ────────────────────────────────────────────────────────────────────
export function Select({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="input max-w-[160px]">
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
