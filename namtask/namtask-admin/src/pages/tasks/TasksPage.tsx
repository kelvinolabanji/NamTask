import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, RefreshCw, MapPin, Calendar, DollarSign } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { fmt, cn } from '../../lib/utils'
import { Table, Badge, Pagination, Select } from '../../components/ui'

const STATUS_OPTS = [
  { value: '',            label: 'All statuses' },
  { value: 'pending',     label: 'Pending' },
  { value: 'accepted',    label: 'Accepted' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed',   label: 'Completed' },
  { value: 'cancelled',   label: 'Cancelled' },
  { value: 'disputed',    label: 'Disputed' },
]
const CAT_OPTS = [
  { value: '',           label: 'All categories' },
  { value: 'cleaning',   label: 'Cleaning' },
  { value: 'delivery',   label: 'Delivery' },
  { value: 'moving',     label: 'Moving' },
  { value: 'repairs',    label: 'Repairs' },
  { value: 'tutoring',   label: 'Tutoring' },
  { value: 'errands',    label: 'Errands' },
  { value: 'caregiving', label: 'Caregiving' },
]

const CAT_EMOJI: Record<string, string> = {
  cleaning:'🧹', delivery:'🚲', moving:'📦', repairs:'🔧',
  tutoring:'📚', errands:'🛍️', caregiving:'❤️', other:'📋',
}

export default function TasksPage() {
  const qc = useQueryClient()
  const [page, setPage]     = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [category, setCat]  = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['admin-tasks', page, search, status, category, dateFrom, dateTo],
    queryFn: () => adminApi.tasks({
      page, limit: 25,
      search:    search   || undefined,
      status:    status   || undefined,
      category:  category || undefined,
      date_from: dateFrom || undefined,
      date_to:   dateTo   || undefined,
    }),
    select: r => r.data,
    placeholderData: (previousData) => previousData
  })

  const tasks = data?.data ?? []
  const pagination = data?.pagination

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-navy-900">Task Monitoring</h1>
          <p className="text-sm text-navy-500 mt-0.5">
            {pagination ? `${fmt.number(pagination.total)} tasks` : 'Loading…'}
          </p>
        </div>
        <button onClick={() => qc.invalidateQueries({ queryKey: ['admin-tasks'] })} className="btn-ghost flex items-center gap-2">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="card-sm flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-navy-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search title or customer…"
            className="input pl-9"
          />
        </div>
        <Select value={status}   onChange={v => { setStatus(v); setPage(1) }} options={STATUS_OPTS} />
        <Select value={category} onChange={v => { setCat(v);    setPage(1) }} options={CAT_OPTS} />
        <div className="flex items-center gap-2">
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }} className="input w-36" />
          <span className="text-navy-400 text-sm">–</span>
          <input type="date" value={dateTo}   onChange={e => { setDateTo(e.target.value);   setPage(1) }} className="input w-36" />
        </div>
        {(search || status || category || dateFrom || dateTo) && (
          <button onClick={() => { setSearch(''); setStatus(''); setCat(''); setDateFrom(''); setDateTo(''); setPage(1) }} className="btn-ghost text-red-500">
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <Table
          headers={['Task', 'Category', 'Customer', 'Tasker', 'Budget', 'Escrow', 'Date', 'Status']}
          loading={isLoading}
          empty={!isLoading && tasks.length === 0}
        >
          {tasks.map((t: any) => (
            <tr key={t.id} className="tr">
              <td className="td max-w-[200px]">
                <p className="font-semibold text-navy-800 truncate">{t.title}</p>
                {t.location_city && (
                  <p className="text-xs text-navy-400 flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3" />{t.location_city}
                  </p>
                )}
                {t.is_sms_booking && <span className="badge-blue text-[10px]">SMS</span>}
              </td>
              <td className="td">
                <span className="flex items-center gap-1.5 text-sm">
                  <span>{CAT_EMOJI[t.category] ?? '📋'}</span>
                  <span className="capitalize">{t.category}</span>
                </span>
              </td>
              <td className="td">
                <p className="text-sm font-medium text-navy-700">{t.customer_name}</p>
                <p className="text-xs text-navy-400">{t.customer_phone}</p>
              </td>
              <td className="td">
                {t.tasker_name
                  ? <><p className="text-sm font-medium text-navy-700">{t.tasker_name}</p><p className="text-xs text-navy-400">{t.tasker_phone}</p></>
                  : <span className="text-navy-300 text-sm">Unassigned</span>
                }
              </td>
              <td className="td font-semibold text-navy-700">{fmt.money(t.budget)}</td>
              <td className="td">
                {t.escrow_amount
                  ? <div>
                      <p className="font-semibold text-sm text-navy-700">{fmt.money(t.escrow_amount)}</p>
                      <Badge status={t.escrow_status} />
                    </div>
                  : <span className="text-navy-300 text-sm">—</span>
                }
              </td>
              <td className="td text-navy-500 whitespace-nowrap text-xs">
                <p>{fmt.date(t.created_at)}</p>
                {t.scheduled_time && (
                  <p className="text-navy-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />{fmt.date(t.scheduled_time)}
                  </p>
                )}
              </td>
              <td className="td"><Badge status={t.status} /></td>
            </tr>
          ))}
        </Table>
        {pagination && <Pagination page={page} limit={25} total={pagination.total} onChange={setPage} />}
      </div>
    </div>
  )
}
