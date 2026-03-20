import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Scale, MessageSquare, DollarSign, ArrowUpRight,
  CheckCircle, Clock, AlertCircle, FileCheck,
} from 'lucide-react'
import { adminApi } from '../../lib/api'
import { fmt, cn } from '../../lib/utils'
import {
  Table, Badge, Avatar, Pagination, Modal,
  PageLoader, Spinner, Select,
} from '../../components/ui'

const STATUS_OPTS = [
  { value: '',            label: 'All statuses' },
  { value: 'open',        label: 'Open' },
  { value: 'under_review',label: 'Under Review' },
  { value: 'resolved',    label: 'Resolved' },
  { value: 'closed',      label: 'Closed' },
]

const WINNER_OPTS = [
  { value: 'customer', label: 'Rule in favour of Customer (refund escrow)' },
  { value: 'tasker',   label: 'Rule in favour of Tasker (release payment)' },
  { value: 'split',    label: 'Split — partial resolution' },
  { value: 'dismiss',  label: 'Dismiss dispute' },
]

export default function DisputesPage() {
  const qc = useQueryClient()
  const [page, setPage]         = useState(1)
  const [status, setStatus]     = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [resolveForm, setResolveForm] = useState<{ open: boolean; id: string; taskId: string; taskerId?: string } | null>(null)
  const [resolution, setResolution]   = useState('')
  const [winner, setWinner]           = useState('')
  const [adminNotes, setAdminNotes]   = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['disputes', page, status],
    queryFn: () => adminApi.disputes({ page, limit: 20, status: status || undefined }),
    select: r => r.data,
    keepPreviousData: true,
  })

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['dispute-detail', selected],
    queryFn: () => adminApi.dispute(selected!),
    select: r => r.data.data,
    enabled: !!selected,
  })

  const resolveMut = useMutation({
    mutationFn: async () => {
      const data: Record<string, unknown> = { resolution, winner, admin_notes: adminNotes || undefined, status: 'resolved' }
      await adminApi.resolveDispute(resolveForm!.id, data)
      // Execute escrow action based on winner
      if (winner === 'customer' && resolveForm?.taskId) {
        await adminApi.refundEscrow(resolveForm.taskId, resolution)
      } else if (winner === 'tasker' && resolveForm?.taskId && resolveForm.taskerId) {
        await adminApi.releaseEscrow(resolveForm.taskId, resolveForm.taskerId)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['disputes'] })
      qc.invalidateQueries({ queryKey: ['dispute-detail', selected] })
      setResolveForm(null); setResolution(''); setWinner(''); setAdminNotes(''); setSelected(null)
    },
  })

  const disputes = data?.data ?? []
  const pagination = data?.pagination

  // Status summary counts
  const { data: statusCounts } = useQuery({
    queryKey: ['dispute-counts'],
    queryFn: async () => {
      const [open, review, resolved] = await Promise.all([
        adminApi.disputes({ status: 'open', limit: 1 }),
        adminApi.disputes({ status: 'under_review', limit: 1 }),
        adminApi.disputes({ status: 'resolved', limit: 1 }),
      ])
      return {
        open:         open.data.pagination?.total ?? 0,
        under_review: review.data.pagination?.total ?? 0,
        resolved:     resolved.data.pagination?.total ?? 0,
      }
    },
    refetchInterval: 30_000,
  })

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-navy-900">Disputes</h1>
        <p className="text-sm text-navy-500 mt-0.5">Mediate and resolve task disputes between users</p>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-3">
        {[
          { label: 'Open',         count: statusCounts?.open,         color: 'bg-red-50 text-red-700 border-red-200',     icon: AlertCircle },
          { label: 'Under Review', count: statusCounts?.under_review, color: 'bg-yellow-50 text-yellow-700 border-yellow-200', icon: Clock },
          { label: 'Resolved',     count: statusCounts?.resolved,     color: 'bg-green-50 text-green-700 border-green-200',   icon: CheckCircle },
        ].map(s => {
          const Icon = s.icon
          return (
            <div key={s.label} className={cn('flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold', s.color)}>
              <Icon className="w-4 h-4" />
              {s.label}: {s.count ?? '…'}
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="card-sm flex gap-3">
        <Select value={status} onChange={v => { setStatus(v); setPage(1) }} options={STATUS_OPTS} placeholder="All statuses" />
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <Table
          headers={['Dispute', 'Task', 'Raised By', 'Against', 'Escrow', 'Date', 'Status', '']}
          loading={isLoading}
          empty={!isLoading && disputes.length === 0}
        >
          {disputes.map((d: any) => (
            <tr key={d.id} className="tr cursor-pointer" onClick={() => setSelected(d.id)}>
              <td className="td max-w-[200px]">
                <p className="font-medium text-navy-800 truncate">{d.reason?.substring(0, 60)}…</p>
                <p className="text-xs text-navy-400 mt-0.5">{fmt.ago(d.created_at)}</p>
              </td>
              <td className="td">
                <p className="text-sm font-medium text-navy-700 truncate max-w-[140px]">{d.task_title}</p>
                <p className="text-xs text-navy-400">{fmt.money(d.budget)}</p>
              </td>
              <td className="td">
                <div className="flex items-center gap-2">
                  <Avatar name={d.raised_by_name} size={7} />
                  <div>
                    <p className="text-sm font-medium text-navy-700">{d.raised_by_name}</p>
                    <p className="text-xs text-navy-400">{d.raised_by_phone}</p>
                  </div>
                </div>
              </td>
              <td className="td">
                <div className="flex items-center gap-2">
                  <Avatar name={d.against_name} size={7} />
                  <p className="text-sm font-medium text-navy-700">{d.against_name}</p>
                </div>
              </td>
              <td className="td font-semibold text-navy-700">{fmt.money(d.budget)}</td>
              <td className="td text-navy-500 whitespace-nowrap">{fmt.date(d.created_at)}</td>
              <td className="td"><Badge status={d.status} /></td>
              <td className="td" onClick={e => e.stopPropagation()}>
                {(d.status === 'open' || d.status === 'under_review') && (
                  <button
                    onClick={() => setResolveForm({ open: true, id: d.id, taskId: d.task_id, taskerId: d.tasker_id })}
                    className="btn-primary py-1 text-xs whitespace-nowrap"
                  >
                    Resolve
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
        {pagination && <Pagination page={page} limit={20} total={pagination.total} onChange={setPage} />}
      </div>

      {/* Detail panel */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title="Dispute Details" width="max-w-3xl">
        {detailLoading ? (
          <div className="flex justify-center py-8"><Spinner className="w-8 h-8" /></div>
        ) : detail ? (
          <DisputeDetail
            dispute={detail}
            onResolve={() => setResolveForm({ open: true, id: detail.id, taskId: detail.task_id, taskerId: detail.against })}
          />
        ) : null}
      </Modal>

      {/* Resolve modal */}
      <Modal
        open={!!resolveForm}
        onClose={() => { setResolveForm(null); setResolution(''); setWinner(''); setAdminNotes('') }}
        title="Resolve Dispute"
        width="max-w-lg"
      >
        {resolveForm && (
          <div className="space-y-4">
            {/* Warning */}
            <div className="flex gap-3 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
              <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800">
                <p className="font-semibold">Escrow action will execute immediately</p>
                <p className="mt-0.5 text-yellow-700">Choosing a winner triggers an automatic escrow transaction that cannot be reversed.</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1.5">Ruling <span className="text-red-500">*</span></label>
              <select value={winner} onChange={e => setWinner(e.target.value)} className="input">
                <option value="">Select ruling…</option>
                {WINNER_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Escrow impact preview */}
            {winner && (
              <div className={cn(
                'rounded-xl p-3 border text-sm',
                winner === 'customer' ? 'bg-blue-50 border-blue-200 text-blue-800'
                : winner === 'tasker'  ? 'bg-green-50 border-green-200 text-green-800'
                :                        'bg-navy-50 border-navy-200 text-navy-700'
              )}>
                {winner === 'customer' && '↩️ Escrow will be refunded to customer'}
                {winner === 'tasker'   && '💸 Escrow will be released to tasker'}
                {winner === 'split'    && '✂️ Manual split — no automatic escrow action'}
                {winner === 'dismiss'  && '📋 Dispute dismissed — no escrow action'}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1.5">Resolution Summary <span className="text-red-500">*</span></label>
              <textarea
                value={resolution}
                onChange={e => setResolution(e.target.value)}
                rows={4}
                className="input"
                placeholder="Explain the decision clearly. This will be shared with both parties."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1.5">Internal Admin Notes</label>
              <textarea
                value={adminNotes}
                onChange={e => setAdminNotes(e.target.value)}
                rows={2}
                className="input"
                placeholder="Private notes for audit log (not shared with users)"
              />
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setResolveForm(null)} className="btn-ghost">Cancel</button>
              <button
                onClick={() => resolveMut.mutate()}
                disabled={resolveMut.isPending || !resolution || !winner}
                className="btn-primary"
              >
                {resolveMut.isPending ? 'Saving…' : 'Submit Resolution'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function DisputeDetail({ dispute, onResolve }: { dispute: any; onResolve: () => void }) {
  return (
    <div className="space-y-5">
      {/* Status bar */}
      <div className="flex items-center justify-between">
        <Badge status={dispute.status} />
        {(dispute.status === 'open' || dispute.status === 'under_review') && (
          <button onClick={onResolve} className="btn-primary text-sm">⚖️ Resolve Dispute</button>
        )}
      </div>

      {/* Parties */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { role: 'Claimant', name: dispute.raised_by_name, phone: dispute.raised_by_phone, email: dispute.raised_by_email },
          { role: 'Respondent', name: dispute.against_name, phone: dispute.against_phone, email: dispute.against_email },
        ].map(p => (
          <div key={p.role} className="bg-navy-50 rounded-xl p-4">
            <p className="text-xs font-semibold text-navy-400 uppercase mb-2">{p.role}</p>
            <div className="flex items-center gap-2">
              <Avatar name={p.name} size={9} />
              <div>
                <p className="font-semibold text-navy-800">{p.name}</p>
                <p className="text-xs text-navy-400">{p.phone}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Task info */}
      <div className="bg-navy-50 rounded-xl p-4 space-y-2">
        <p className="text-xs font-semibold text-navy-400 uppercase">Task Details</p>
        <p className="font-bold text-navy-800 text-base">{dispute.task_title}</p>
        <div className="flex flex-wrap gap-4 text-sm text-navy-600">
          <span>💰 Budget: {fmt.money(dispute.budget)}</span>
          <span>📋 Status: <Badge status={dispute.task_status} /></span>
          {dispute.escrow_amount && <span>🔒 Escrow: {fmt.money(dispute.escrow_amount)} ({dispute.escrow_status})</span>}
          <span>📅 Created: {fmt.date(dispute.task_created_at)}</span>
          <span>💬 {dispute.chat_message_count} messages</span>
        </div>
      </div>

      {/* Reason */}
      <div>
        <p className="text-xs font-semibold text-navy-400 uppercase mb-2">Dispute Reason</p>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-800 leading-relaxed">{dispute.reason}</p>
        </div>
      </div>

      {/* Evidence */}
      {dispute.evidence_urls?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-navy-400 uppercase mb-2">Evidence ({dispute.evidence_urls.length} files)</p>
          <div className="flex flex-wrap gap-2">
            {dispute.evidence_urls.map((url: string, i: number) => (
              <a key={i} href={url} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-sm text-teal-600 hover:text-teal-700 bg-teal-50 px-3 py-1.5 rounded-lg border border-teal-200 font-medium">
                <FileCheck className="w-4 h-4" /> File {i + 1}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Resolution */}
      {dispute.resolution && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-green-600 uppercase mb-1.5">Resolution</p>
          <p className="text-sm text-green-800">{dispute.resolution}</p>
          <p className="text-xs text-green-600 mt-1.5">Resolved by {dispute.resolved_by_name} · {fmt.datetime(dispute.resolved_at)}</p>
        </div>
      )}
    </div>
  )
}
