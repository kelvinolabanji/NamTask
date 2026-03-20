import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, DollarSign, Filter } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { fmt, TX_ICONS, cn } from '../../lib/utils'
import { Table, Badge, Pagination, Select } from '../../components/ui'

const TYPE_OPTS = [
  { value: '',               label: 'All types' },
  { value: 'deposit',        label: 'Deposits' },
  { value: 'withdrawal',     label: 'Withdrawals' },
  { value: 'escrow_hold',    label: 'Escrow Holds' },
  { value: 'escrow_release', label: 'Escrow Releases' },
  { value: 'payout',         label: 'Payouts' },
  { value: 'commission',     label: 'Commission' },
  { value: 'refund',         label: 'Refunds' },
]

const CREDIT_TYPES = new Set(['deposit', 'payout', 'escrow_release', 'refund'])

export default function TransactionsPage() {
  const [page, setPage]       = useState(1)
  const [type, setType]       = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['admin-transactions', page, type, dateFrom, dateTo],
    queryFn: () => adminApi.transactions({
      page, limit: 30,
      type:      type     || undefined,
      date_from: dateFrom || undefined,
      date_to:   dateTo   || undefined,
    }),
    select: r => r.data,
    placeholderData: (previousData) => previousData
  })

  const transactions = data?.data ?? []
  const pagination   = data?.pagination
  const summary      = data?.summary

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-navy-900">Transactions</h1>
        <p className="text-sm text-navy-500 mt-0.5">Platform-wide financial activity</p>
      </div>

      {/* Volume summary */}
      {summary && (
        <div className="grid grid-cols-2 gap-4">
          <div className="card flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-teal-50 border border-teal-200">
              <TrendingUp className="w-5 h-5 text-teal-700" />
            </div>
            <div>
              <p className="text-sm text-navy-500">Total Volume (filtered)</p>
              <p className="text-2xl font-extrabold text-navy-900">{fmt.money(summary.total_volume ?? 0)}</p>
            </div>
          </div>
          <div className="card flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-navy-100 border border-navy-200">
              <Filter className="w-5 h-5 text-navy-600" />
            </div>
            <div>
              <p className="text-sm text-navy-500">Transactions Shown</p>
              <p className="text-2xl font-extrabold text-navy-900">{fmt.number(pagination?.total ?? 0)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card-sm flex flex-wrap gap-3">
        <Select value={type} onChange={v => { setType(v); setPage(1) }} options={TYPE_OPTS} />
        <div className="flex items-center gap-2">
          <label className="text-xs text-navy-500 whitespace-nowrap">From</label>
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }} className="input w-36" />
          <label className="text-xs text-navy-500">to</label>
          <input type="date" value={dateTo}   onChange={e => { setDateTo(e.target.value);   setPage(1) }} className="input w-36" />
        </div>
        {(type || dateFrom || dateTo) && (
          <button onClick={() => { setType(''); setDateFrom(''); setDateTo(''); setPage(1) }} className="btn-ghost text-red-500 text-sm">
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <Table
          headers={['Type', 'User', 'Task', 'Amount', 'Balance After', 'Ref', 'Date']}
          loading={isLoading}
          empty={!isLoading && transactions.length === 0}
        >
          {transactions.map((tx: any) => {
            const isCredit = CREDIT_TYPES.has(tx.type)
            const icon     = TX_ICONS[tx.type] ?? '↔'
            return (
              <tr key={tx.id} className="tr">
                <td className="td">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0',
                      isCredit ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    )}>
                      {icon}
                    </span>
                    <span className="text-sm font-medium capitalize">{tx.type.replace(/_/g, ' ')}</span>
                  </div>
                </td>
                <td className="td">
                  <p className="text-sm font-medium text-navy-700">{tx.user_name}</p>
                  <span className={cn('text-[10px]', tx.user_role === 'tasker' ? 'badge-blue' : 'badge-gray')}>{tx.user_role}</span>
                </td>
                <td className="td text-navy-500 text-sm max-w-[150px]">
                  <p className="truncate">{tx.task_title ?? '—'}</p>
                </td>
                <td className="td">
                  <span className={cn('font-extrabold text-sm', isCredit ? 'text-green-700' : 'text-red-600')}>
                    {isCredit ? '+' : '−'} {fmt.money(tx.amount)}
                  </span>
                </td>
                <td className="td font-mono text-sm text-navy-600">
                  {fmt.money(tx.balance_after)}
                </td>
                <td className="td">
                  <p className="font-mono text-xs text-navy-400 max-w-[120px] truncate" title={tx.reference}>
                    {tx.reference}
                  </p>
                </td>
                <td className="td text-navy-500 whitespace-nowrap text-xs">
                  {fmt.datetime(tx.created_at)}
                </td>
              </tr>
            )
          })}
        </Table>
        {pagination && <Pagination page={page} limit={30} total={pagination.total} onChange={setPage} />}
      </div>
    </div>
  )
}
