import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldCheck, ShieldX, Clock, Eye, ExternalLink,
  CheckCircle2, XCircle, AlertCircle, FileText, Briefcase,
} from 'lucide-react'
import { adminApi } from '../../lib/api'
import { fmt, cn } from '../../lib/utils'
import {
  Table, Badge, Avatar, Pagination, Modal,
  PageLoader, Spinner, Select,
} from '../../components/ui'

const STATUS_TABS = [
  { value: 'pending',   label: 'Pending',   icon: Clock,         color: 'text-yellow-600 bg-yellow-50' },
  { value: 'in_review', label: 'In Review',  icon: Eye,           color: 'text-blue-600 bg-blue-50' },
  { value: 'approved',  label: 'Approved',   icon: CheckCircle2,  color: 'text-green-600 bg-green-50' },
  { value: 'rejected',  label: 'Rejected',   icon: XCircle,       color: 'text-red-600 bg-red-50' },
]

export default function KYCPage() {
  const qc = useQueryClient()
  const [tab, setTab]           = useState('pending')
  const [page, setPage]         = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [decision, setDecision] = useState<{ id: string; name: string; action: 'approved' | 'rejected' } | null>(null)
  const [reason, setReason]     = useState('')
  const [notes, setNotes]       = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['kyc-list', tab, page],
    queryFn: () => adminApi.kycList({ status: tab, page, limit: 20 }),
    select: r => r.data,
    placeholderData: (previousData) => previousData
  })

  const { data: kycDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['kyc-detail', selected],
    queryFn: () => adminApi.kycDetail(selected!),
    select: r => r.data.data,
    enabled: !!selected,
  })

  // Per-tab counts query
  const { data: counts } = useQuery({
    queryKey: ['kyc-counts'],
    queryFn: async () => {
      const results = await Promise.all(
        STATUS_TABS.map(t => adminApi.kycList({ status: t.value, limit: 1 }))
      )
      return Object.fromEntries(STATUS_TABS.map((t, i) => [t.value, results[i].data.pagination?.total ?? 0]))
    },
    refetchInterval: 30_000,
  })

  const decisionMut = useMutation({
    mutationFn: () => adminApi.kycDecision(decision!.id, decision!.action, reason || undefined, notes || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kyc-list'] })
      qc.invalidateQueries({ queryKey: ['kyc-counts'] })
      qc.invalidateQueries({ queryKey: ['kyc-detail'] })
      setDecision(null); setReason(''); setNotes(''); setSelected(null)
    },
  })

  const applicants = data?.data ?? []
  const pagination = data?.pagination

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-navy-900">KYC Approvals</h1>
        <p className="text-sm text-navy-500 mt-0.5">Review and verify tasker identity documents</p>
      </div>

      {/* Tab counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {STATUS_TABS.map(t => {
          const Icon = t.icon
          const count = counts?.[t.value] ?? '…'
          return (
            <button
              key={t.value}
              onClick={() => { setTab(t.value); setPage(1) }}
              className={cn(
                'card-sm flex items-center gap-3 text-left transition-all',
                tab === t.value ? 'ring-2 ring-teal-500' : 'hover:shadow-md'
              )}
            >
              <div className={cn('p-2 rounded-lg', t.color)}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xl font-extrabold text-navy-900">{typeof count === 'number' ? count.toLocaleString() : count}</p>
                <p className="text-xs text-navy-500">{t.label}</p>
              </div>
            </button>
          )
        })}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-navy-100 flex items-center justify-between">
          <p className="font-semibold text-navy-700 capitalize">{tab.replace('_', ' ')} Applications</p>
          {tab === 'pending' && counts?.pending > 0 && (
            <span className="badge-red animate-pulse">{counts?.pending} awaiting review</span>
          )}
        </div>
        <Table
          headers={['Tasker', 'Skills / Categories', 'Hourly Rate', 'Applied', 'Document', 'Actions']}
          loading={isLoading}
          empty={!isLoading && applicants.length === 0}
        >
          {applicants.map((a: any) => (
            <tr key={a.id} className="tr">
              <td className="td">
                <div className="flex items-center gap-3">
                  <Avatar name={a.name} url={a.avatar_url} size={9} />
                  <div>
                    <p className="font-semibold text-navy-800">{a.name}</p>
                    <p className="text-xs text-navy-400">{a.phone}</p>
                  </div>
                </div>
              </td>
              <td className="td max-w-[200px]">
                <div className="flex flex-wrap gap-1">
                  {a.categories?.slice(0, 3).map((c: string) => (
                    <span key={c} className="badge-gray capitalize text-[11px]">{c}</span>
                  ))}
                  {a.categories?.length > 3 && (
                    <span className="text-xs text-navy-400">+{a.categories.length - 3}</span>
                  )}
                </div>
              </td>
              <td className="td font-semibold text-navy-700">
                {a.hourly_rate ? `NAD ${a.hourly_rate}/hr` : '—'}
              </td>
              <td className="td text-navy-500 whitespace-nowrap">{fmt.ago(a.profile_updated_at)}</td>
              <td className="td">
                {a.id_document_url ? (
                  <a
                    href={a.id_document_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-teal-600 hover:text-teal-700 text-sm font-medium"
                  >
                    <FileText className="w-4 h-4" /> View <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-navy-300 text-sm">Not uploaded</span>
                )}
              </td>
              <td className="td">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSelected(a.id)}
                    className="btn-ghost py-1 px-2 text-xs"
                  >
                    Review
                  </button>
                  {(tab === 'pending' || tab === 'in_review') && (
                    <>
                      <button
                        onClick={() => setDecision({ id: a.id, name: a.name, action: 'approved' })}
                        className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                        title="Approve"
                      >
                        <ShieldCheck className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDecision({ id: a.id, name: a.name, action: 'rejected' })}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Reject"
                      >
                        <ShieldX className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
        {pagination && <Pagination page={page} limit={20} total={pagination.total} onChange={setPage} />}
      </div>

      {/* Detail modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title="KYC Profile Review" width="max-w-2xl">
        {detailLoading ? (
          <div className="flex justify-center py-8"><Spinner className="w-8 h-8" /></div>
        ) : kycDetail ? (
          <KYCDetail
            profile={kycDetail}
            onApprove={() => { setSelected(null); setDecision({ id: kycDetail.user_id, name: kycDetail.name, action: 'approved' }) }}
            onReject={()  => { setSelected(null); setDecision({ id: kycDetail.user_id, name: kycDetail.name, action: 'rejected' }) }}
          />
        ) : null}
      </Modal>

      {/* Decision modal */}
      <Modal
        open={!!decision}
        onClose={() => { setDecision(null); setReason(''); setNotes('') }}
        title={decision?.action === 'approved' ? '✅ Approve Tasker' : '❌ Reject Tasker'}
        width="max-w-md"
      >
        {decision && (
          <div className="space-y-4">
            <div className={cn(
              'flex items-center gap-3 p-3 rounded-xl',
              decision.action === 'approved' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
            )}>
              {decision.action === 'approved'
                ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                : <XCircle     className="w-5 h-5 text-red-600 shrink-0" />
              }
              <p className="text-sm font-medium text-navy-700">
                {decision.action === 'approved'
                  ? `${decision.name} will be approved and can start accepting tasks.`
                  : `${decision.name}'s application will be rejected.`
                }
              </p>
            </div>

            {decision.action === 'rejected' && (
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1.5">Rejection Reason <span className="text-red-500">*</span></label>
                <select
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  className="input"
                >
                  <option value="">Select a reason…</option>
                  <option value="id_unclear">ID document unclear or expired</option>
                  <option value="id_mismatch">Name doesn't match ID</option>
                  <option value="incomplete_profile">Profile incomplete</option>
                  <option value="suspicious_activity">Suspicious activity detected</option>
                  <option value="duplicate_account">Possible duplicate account</option>
                  <option value="other">Other (see notes)</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1.5">Admin Notes (optional)</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                className="input"
                placeholder="Internal notes for audit trail…"
              />
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => { setDecision(null); setReason(''); setNotes('') }} className="btn-ghost">
                Cancel
              </button>
              <button
                onClick={() => decisionMut.mutate()}
                disabled={decisionMut.isPending || (decision.action === 'rejected' && !reason)}
                className={decision.action === 'approved' ? 'btn-primary' : 'btn-danger'}
              >
                {decisionMut.isPending ? 'Saving…' : decision.action === 'approved' ? 'Approve Tasker' : 'Reject Application'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function KYCDetail({ profile, onApprove, onReject }: { profile: any; onApprove: () => void; onReject: () => void }) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Avatar name={profile.name} url={profile.avatar_url} size={14} />
        <div>
          <h3 className="text-xl font-bold text-navy-900">{profile.name}</h3>
          <p className="text-navy-500 text-sm">{profile.phone} · {profile.email}</p>
          <div className="flex gap-2 mt-1">
            <Badge status={profile.verification_status} />
            {profile.background_check_passed && <span className="badge-green">Background ✓</span>}
          </div>
        </div>
      </div>

      {/* Bio */}
      {profile.bio && (
        <div className="bg-navy-50 rounded-xl p-4">
          <p className="text-xs font-semibold text-navy-500 uppercase mb-1.5">Bio</p>
          <p className="text-sm text-navy-700 leading-relaxed">{profile.bio}</p>
        </div>
      )}

      {/* Skills + Categories */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-navy-500 uppercase mb-2">Skills</p>
          <div className="flex flex-wrap gap-1.5">
            {profile.skills?.map((s: string) => (
              <span key={s} className="bg-teal-50 text-teal-700 text-xs font-medium px-2.5 py-1 rounded-full border border-teal-200">{s}</span>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-navy-500 uppercase mb-2">Categories</p>
          <div className="flex flex-wrap gap-1.5">
            {profile.categories?.map((c: string) => (
              <span key={c} className="bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full border border-blue-200 capitalize">{c}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Tasks Done',    value: profile.total_tasks_completed ?? 0 },
          { label: 'Hourly Rate',   value: profile.hourly_rate ? `NAD ${profile.hourly_rate}` : '—' },
          { label: 'Radius',        value: profile.service_radius_km ? `${profile.service_radius_km} km` : '—' },
        ].map(s => (
          <div key={s.label} className="bg-navy-50 rounded-xl p-3 text-center">
            <p className="text-base font-extrabold text-navy-900">{s.value}</p>
            <p className="text-xs text-navy-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ID document */}
      <div>
        <p className="text-xs font-semibold text-navy-500 uppercase mb-2">Identity Document</p>
        {profile.id_document_url ? (
          <a
            href={profile.id_document_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 p-3 bg-navy-50 rounded-xl border border-navy-200 hover:border-teal-400 transition-colors group"
          >
            <FileText className="w-8 h-8 text-navy-400 group-hover:text-teal-600" />
            <div>
              <p className="text-sm font-semibold text-navy-700 group-hover:text-teal-700">View ID Document</p>
              <p className="text-xs text-navy-400">Opens in new tab</p>
            </div>
            <ExternalLink className="w-4 h-4 text-navy-400 ml-auto" />
          </a>
        ) : (
          <div className="flex items-center gap-2 p-3 bg-yellow-50 rounded-xl border border-yellow-200">
            <AlertCircle className="w-4 h-4 text-yellow-600" />
            <p className="text-sm text-yellow-700">No ID document uploaded yet</p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {(profile.verification_status === 'pending' || profile.verification_status === 'in_review') && (
        <div className="flex gap-3 pt-2 border-t border-navy-100">
          <button onClick={onReject}  className="btn-danger  flex-1">❌ Reject</button>
          <button onClick={onApprove} className="btn-primary flex-1">✅ Approve</button>
        </div>
      )}
    </div>
  )
}
