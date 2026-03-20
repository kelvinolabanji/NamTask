import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, UserCheck, UserX, Eye, RefreshCw,
  Phone, Mail, Star, Wallet, MapPin, Calendar,
} from 'lucide-react'
import { adminApi } from '../../lib/api'
import { fmt, cn } from '../../lib/utils'
import {
  Table, Badge, Avatar, Pagination, Modal,
  PageLoader, EmptyState, SearchInput, Select, Spinner,
} from '../../components/ui'

const ROLE_OPTS = [
  { value: '',         label: 'All roles' },
  { value: 'customer', label: 'Customers' },
  { value: 'tasker',   label: 'Taskers' },
  { value: 'admin',    label: 'Admins' },
]
const KYC_OPTS = [
  { value: '',           label: 'Any KYC status' },
  { value: 'pending',    label: 'Pending' },
  { value: 'in_review',  label: 'In Review' },
  { value: 'approved',   label: 'Approved' },
  { value: 'rejected',   label: 'Rejected' },
]

export default function UsersPage() {
  const qc = useQueryClient()
  const [page, setPage]         = useState(1)
  const [search, setSearch]     = useState('')
  const [role, setRole]         = useState('')
  const [kycStatus, setKyc]     = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmToggle, setConfirmToggle] = useState<{ id: string; name: string; active: boolean } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', page, search, role, kycStatus],
    queryFn: () => adminApi.users({ page, limit: 25, search: search || undefined, role: role || undefined, kyc_status: kycStatus || undefined }),
    select: r => r.data,
    keepPreviousData: true,
  })

  const { data: userDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['admin-user', selected],
    queryFn: () => adminApi.user(selected!),
    select: r => r.data.data,
    enabled: !!selected,
  })

  const toggleMut = useMutation({
    mutationFn: (id: string) => adminApi.toggleUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      qc.invalidateQueries({ queryKey: ['admin-user', confirmToggle?.id] })
      setConfirmToggle(null)
    },
  })

  const users = data?.data ?? []
  const pagination = data?.pagination

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-navy-900">Users</h1>
          <p className="text-sm text-navy-500 mt-0.5">
            {pagination ? `${fmt.number(pagination.total)} total` : 'Loading…'}
          </p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['admin-users'] })}
          className="btn-ghost flex items-center gap-2"
        >
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
            placeholder="Search name, phone, email…"
            className="input pl-9"
          />
        </div>
        <Select value={role}      onChange={v => { setRole(v); setPage(1) }}      options={ROLE_OPTS}  placeholder="All roles" />
        <Select value={kycStatus} onChange={v => { setKyc(v); setPage(1) }}       options={KYC_OPTS}   placeholder="KYC status" />
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <Table
          headers={['User', 'Role', 'KYC', 'Wallet', 'Rating', 'Joined', 'Status', '']}
          loading={isLoading}
          empty={!isLoading && users.length === 0}
        >
          {users.map((u: any) => (
            <tr key={u.id} className="tr">
              <td className="td">
                <div className="flex items-center gap-3">
                  <Avatar name={u.name} url={u.avatar_url} size={9} />
                  <div>
                    <p className="font-semibold text-navy-800 leading-none">{u.name}</p>
                    <p className="text-xs text-navy-400 mt-0.5">{u.phone}</p>
                  </div>
                </div>
              </td>
              <td className="td">
                <span className={cn(
                  'badge-gray capitalize',
                  u.role === 'admin' ? 'badge-purple' : u.role === 'tasker' ? 'badge-blue' : ''
                )}>{u.role}</span>
              </td>
              <td className="td">
                {u.verification_status
                  ? <Badge status={u.verification_status} />
                  : <span className="text-navy-300 text-xs">—</span>
                }
              </td>
              <td className="td font-mono text-sm font-semibold text-teal-700">
                {fmt.money(u.wallet_balance ?? 0)}
              </td>
              <td className="td">
                {parseFloat(u.rating) > 0
                  ? <span className="text-yellow-600 font-semibold">★ {parseFloat(u.rating).toFixed(1)}</span>
                  : <span className="text-navy-300">—</span>
                }
              </td>
              <td className="td text-navy-500">{fmt.date(u.created_at)}</td>
              <td className="td">
                <span className={u.is_active ? 'badge-green' : 'badge-red'}>
                  {u.is_active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td className="td">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setSelected(u.id)}
                    className="p-1.5 text-navy-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                    title="View details"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setConfirmToggle({ id: u.id, name: u.name, active: u.is_active })}
                    className={cn(
                      'p-1.5 rounded-lg transition-colors',
                      u.is_active
                        ? 'text-navy-400 hover:text-red-600 hover:bg-red-50'
                        : 'text-navy-400 hover:text-green-600 hover:bg-green-50'
                    )}
                    title={u.is_active ? 'Deactivate' : 'Activate'}
                  >
                    {u.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
        {pagination && (
          <Pagination page={page} limit={25} total={pagination.total} onChange={setPage} />
        )}
      </div>

      {/* User detail drawer */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title="User Details"
        width="max-w-2xl"
      >
        {detailLoading ? (
          <div className="flex justify-center py-8"><Spinner className="w-8 h-8" /></div>
        ) : userDetail ? (
          <UserDetail user={userDetail} onToggle={() => setConfirmToggle({ id: userDetail.id, name: userDetail.name, active: userDetail.is_active })} />
        ) : null}
      </Modal>

      {/* Toggle confirm */}
      <Modal
        open={!!confirmToggle}
        onClose={() => setConfirmToggle(null)}
        title={confirmToggle?.active ? 'Deactivate User' : 'Activate User'}
        width="max-w-sm"
      >
        {confirmToggle && (
          <div className="space-y-4">
            <p className="text-navy-600 text-sm">
              {confirmToggle.active
                ? `Are you sure you want to deactivate <strong>${confirmToggle.name}</strong>? They will not be able to log in.`
                : `Reactivate <strong>${confirmToggle.name}</strong>? They will regain full access.`
              }
            </p>
            <p className="text-navy-600 text-sm">
              {confirmToggle.active
                ? `Deactivate ${confirmToggle.name}? They will not be able to log in.`
                : `Reactivate ${confirmToggle.name}? They will regain full access.`
              }
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmToggle(null)} className="btn-ghost">Cancel</button>
              <button
                onClick={() => toggleMut.mutate(confirmToggle.id)}
                disabled={toggleMut.isPending}
                className={confirmToggle.active ? 'btn-danger' : 'btn-primary'}
              >
                {toggleMut.isPending ? 'Saving…' : confirmToggle.active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function UserDetail({ user, onToggle }: { user: any; onToggle: () => void }) {
  return (
    <div className="space-y-5">
      {/* Profile header */}
      <div className="flex items-center gap-4">
        <Avatar name={user.name} url={user.avatar_url} size={14} />
        <div>
          <h3 className="text-xl font-bold text-navy-900">{user.name}</h3>
          <div className="flex items-center gap-3 mt-1">
            <span className={cn('capitalize', user.role === 'tasker' ? 'badge-blue' : 'badge-gray')}>{user.role}</span>
            <span className={user.is_active ? 'badge-green' : 'badge-red'}>{user.is_active ? 'Active' : 'Inactive'}</span>
            {user.verification_status && <Badge status={user.verification_status} />}
          </div>
        </div>
        <button onClick={onToggle} className={cn('ml-auto text-sm font-medium', user.is_active ? 'text-red-600 hover:underline' : 'text-green-600 hover:underline')}>
          {user.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </div>

      {/* Contact */}
      <div className="grid grid-cols-2 gap-3">
        <InfoRow icon={Phone}    label="Phone"   value={user.phone} />
        <InfoRow icon={Mail}     label="Email"   value={user.email ?? '—'} />
        <InfoRow icon={Calendar} label="Joined"  value={fmt.datetime(user.created_at)} />
        <InfoRow icon={Star}     label="Rating"  value={`${parseFloat(user.rating ?? 0).toFixed(1)} (${user.rating_count} reviews)`} />
      </div>

      {/* Wallet */}
      <div className="bg-navy-50 rounded-xl p-4 grid grid-cols-3 gap-4">
        <div className="text-center">
          <p className="text-xs text-navy-400 mb-1">Balance</p>
          <p className="font-extrabold text-teal-700">{fmt.money(user.balance ?? 0)}</p>
        </div>
        <div className="text-center border-x border-navy-200">
          <p className="text-xs text-navy-400 mb-1">In Escrow</p>
          <p className="font-extrabold text-yellow-700">{fmt.money(user.escrow_balance ?? 0)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-navy-400 mb-1">Total Earned</p>
          <p className="font-extrabold text-green-700">{fmt.money(user.total_earned ?? 0)}</p>
        </div>
      </div>

      {/* Activity */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-navy-50 rounded-lg p-3">
          <p className="text-navy-400 text-xs">Tasks Posted</p>
          <p className="font-bold text-navy-800 text-lg">{user.tasks_posted ?? 0}</p>
        </div>
        <div className="bg-navy-50 rounded-lg p-3">
          <p className="text-navy-400 text-xs">Tasks Worked</p>
          <p className="font-bold text-navy-800 text-lg">{user.tasks_worked ?? 0}</p>
        </div>
      </div>

      {/* Tasker-specific */}
      {user.role === 'tasker' && user.skills?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-2">Skills</p>
          <div className="flex flex-wrap gap-2">
            {user.skills.map((s: string) => (
              <span key={s} className="bg-teal-50 text-teal-700 text-xs font-medium px-2.5 py-1 rounded-full border border-teal-200">{s}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4 text-navy-400 shrink-0" />
      <div>
        <p className="text-xs text-navy-400">{label}</p>
        <p className="text-sm font-medium text-navy-800">{value}</p>
      </div>
    </div>
  )
}
