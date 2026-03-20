import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, CheckCircle, Clock, MapPin,
  Phone, User, RefreshCw, ExternalLink, Bell,
} from 'lucide-react'
import { adminApi } from '../../lib/api'
import { fmt, cn } from '../../lib/utils'
import { PageLoader, Modal, Spinner } from '../../components/ui'

export default function SOSPage() {
  const qc = useQueryClient()
  const [showResolved, setShowResolved] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [newAlertCount, setNewAlertCount] = useState(0)

  const { data: active, isLoading: loadingActive } = useQuery({
    queryKey: ['sos-active'],
    queryFn: () => adminApi.sosList({ is_resolved: 'false' }),
    select: r => r.data.data,
    refetchInterval: 15_000, // poll every 15s for live feed
  })

  const { data: resolved, isLoading: loadingResolved } = useQuery({
    queryKey: ['sos-resolved'],
    queryFn: () => adminApi.sosList({ is_resolved: 'true' }),
    select: r => r.data.data,
    enabled: showResolved,
  })

  // Flash title on new unresolved alerts
  useEffect(() => {
    if (!active) return
    if (active.length > newAlertCount && newAlertCount > 0) {
      document.title = `🚨 NEW SOS — Nam Task Admin`
      const t = setTimeout(() => { document.title = 'Nam Task Admin' }, 5000)
      return () => clearTimeout(t)
    }
    setNewAlertCount(active.length)
  }, [active?.length])

  const resolveMut = useMutation({
    mutationFn: (id: string) => adminApi.resolveSOSAlert(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sos-active'] })
      qc.invalidateQueries({ queryKey: ['sos-resolved'] })
      setConfirm(null)
    },
  })

  const activeAlerts   = active ?? []
  const resolvedAlerts = resolved ?? []

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            'p-2.5 rounded-xl',
            activeAlerts.length > 0 ? 'bg-red-100 animate-pulse' : 'bg-navy-100'
          )}>
            <AlertTriangle className={cn('w-6 h-6', activeAlerts.length > 0 ? 'text-red-600' : 'text-navy-500')} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-navy-900">SOS Alerts</h1>
            <p className="text-sm text-navy-500">Emergency safety alerts from field users</p>
          </div>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['sos-active'] })}
          className="btn-ghost flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Active alert banner */}
      {activeAlerts.length > 0 && (
        <div className="bg-red-600 text-white rounded-2xl p-4 flex items-center gap-3">
          <Bell className="w-6 h-6 shrink-0 animate-bounce" />
          <p className="font-bold text-lg">
            {activeAlerts.length} Active SOS Alert{activeAlerts.length > 1 ? 's' : ''} — Immediate Attention Required
          </p>
        </div>
      )}

      {/* Active alerts */}
      {loadingActive ? <PageLoader /> : (
        <>
          {activeAlerts.length === 0 ? (
            <div className="card flex flex-col items-center py-16 text-navy-400">
              <CheckCircle className="w-16 h-16 text-green-400 mb-4" />
              <p className="text-lg font-semibold text-navy-600">All clear</p>
              <p className="text-sm mt-1">No active SOS alerts right now</p>
              <p className="text-xs text-navy-400 mt-1">Auto-refreshes every 15 seconds</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeAlerts.map((alert: any) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  active
                  onResolve={() => setConfirm(alert.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Resolved alerts toggle */}
      <div className="border-t border-navy-200 pt-4">
        <button
          onClick={() => setShowResolved(!showResolved)}
          className="flex items-center gap-2 text-sm font-medium text-navy-600 hover:text-navy-900 transition-colors"
        >
          <Clock className="w-4 h-4" />
          {showResolved ? 'Hide' : 'Show'} Resolved Alerts
          {resolvedAlerts.length > 0 && (
            <span className="badge-gray ml-1">{resolvedAlerts.length}</span>
          )}
        </button>

        {showResolved && (
          <div className="mt-4 space-y-3">
            {loadingResolved ? (
              <div className="flex justify-center py-8"><Spinner className="w-7 h-7" /></div>
            ) : resolvedAlerts.length === 0 ? (
              <p className="text-sm text-navy-400 text-center py-6">No resolved alerts</p>
            ) : (
              resolvedAlerts.map((alert: any) => (
                <AlertCard key={alert.id} alert={alert} active={false} />
              ))
            )}
          </div>
        )}
      </div>

      {/* Confirm resolve modal */}
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Resolve SOS Alert" width="max-w-sm">
        {confirm && (
          <div className="space-y-4">
            <p className="text-sm text-navy-600">
              Mark this SOS alert as resolved? Only do this after confirming the user is safe and the situation has been handled.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirm(null)} className="btn-ghost">Cancel</button>
              <button
                onClick={() => resolveMut.mutate(confirm)}
                disabled={resolveMut.isPending}
                className="btn-primary"
              >
                {resolveMut.isPending ? 'Saving…' : '✓ Mark Resolved'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function AlertCard({ alert, active, onResolve }: { alert: any; active: boolean; onResolve?: () => void }) {
  const mapsUrl = alert.latitude && alert.longitude
    ? `https://maps.google.com/?q=${alert.latitude},${alert.longitude}`
    : null

  return (
    <div className={cn(
      'rounded-2xl border p-5 space-y-4',
      active
        ? 'bg-red-50 border-red-300 shadow-md shadow-red-100'
        : 'bg-white border-navy-200'
    )}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center shrink-0',
            active ? 'bg-red-600' : 'bg-navy-400'
          )}>
            <AlertTriangle className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={active ? 'badge-red' : 'badge-gray'}>
                {active ? '🚨 ACTIVE' : '✓ Resolved'}
              </span>
              <span className="text-xs text-navy-400">{fmt.ago(alert.created_at)}</span>
            </div>
            <p className="font-bold text-navy-900 mt-1">{alert.user_name}</p>
          </div>
        </div>
        {active && onResolve && (
          <button onClick={onResolve} className="btn-primary text-sm shrink-0">
            ✓ Mark Resolved
          </button>
        )}
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Phone className="w-4 h-4 text-navy-400 shrink-0" />
          <a href={`tel:${alert.user_phone}`} className="text-navy-700 hover:text-teal-600 font-medium">
            {alert.user_phone}
          </a>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <User className="w-4 h-4 text-navy-400 shrink-0" />
          <span className="text-navy-600 capitalize">{alert.user_role}</span>
        </div>
        {alert.task_title && (
          <div className="flex items-start gap-2 text-sm col-span-2">
            <span className="text-navy-400 shrink-0 mt-0.5">📋</span>
            <span className="text-navy-600">Task: <span className="font-medium">{alert.task_title}</span></span>
          </div>
        )}
        {mapsUrl && (
          <div className="flex items-center gap-2 text-sm col-span-2">
            <MapPin className="w-4 h-4 text-red-500 shrink-0" />
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-red-600 hover:text-red-700 font-semibold flex items-center gap-1"
            >
              View on Google Maps
              <ExternalLink className="w-3 h-3" />
            </a>
            <span className="text-navy-400 text-xs">
              ({parseFloat(alert.latitude).toFixed(4)}, {parseFloat(alert.longitude).toFixed(4)})
            </span>
          </div>
        )}
      </div>

      {/* Notes */}
      {alert.notes && alert.notes !== 'SOS triggered' && (
        <div className="bg-white border border-red-200 rounded-xl p-3">
          <p className="text-xs text-navy-500 uppercase font-semibold mb-1">User's Note</p>
          <p className="text-sm text-navy-700 italic">"{alert.notes}"</p>
        </div>
      )}

      {alert.resolved_at && (
        <p className="text-xs text-green-600 font-medium">
          Resolved {fmt.ago(alert.resolved_at)}
        </p>
      )}
    </div>
  )
}
