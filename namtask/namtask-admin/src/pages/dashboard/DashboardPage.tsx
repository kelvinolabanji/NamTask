import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  Users, ClipboardList, DollarSign, TrendingUp,
  AlertTriangle, CheckCircle, Clock, BarChart2,
} from 'lucide-react'
import { adminApi } from '../../lib/api'
import { fmt } from '../../lib/utils'
import { StatCard, PageLoader, Select } from '../../components/ui'

const TEAL  = '#0d9488'
const GOLD  = '#d97706'
const NAVY  = '#334155'
const GREEN = '#10b981'
const RED   = '#ef4444'
const PURPLE= '#8b5cf6'

const CATEGORY_COLORS = [TEAL, GOLD, NAVY, GREEN, RED, PURPLE, '#f97316', '#06b6d4']

const tooltipStyle = {
  backgroundColor: '#0f172a', border: '1px solid #334155',
  borderRadius: 8, color: '#f1f5f9', fontSize: 12,
}

export default function DashboardPage() {
  const [period, setPeriod] = useState('30')

  const { data, isLoading } = useQuery({
    queryKey: ['analytics', period],
    queryFn:  () => adminApi.analytics(parseInt(period)),
    select:   r => r.data.data,
    refetchInterval: 60_000,
  })

  if (isLoading || !data) return <PageLoader />

  const { kpis, charts, top_categories, top_taskers, payment_providers } = data

  const completionRate = kpis.tasks.total > 0
    ? ((kpis.tasks.completed / kpis.tasks.total) * 100).toFixed(1)
    : '0'

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-navy-900">Dashboard</h1>
          <p className="text-sm text-navy-500 mt-0.5">Platform overview · Live data</p>
        </div>
        <Select
          value={period}
          onChange={setPeriod}
          options={[
            { value: '7',   label: 'Last 7 days' },
            { value: '30',  label: 'Last 30 days' },
            { value: '90',  label: 'Last 90 days' },
            { value: '365', label: 'Last year' },
          ]}
        />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Users"
          value={fmt.number(kpis.users.total_users)}
          sub={`+${kpis.users.new_this_period} this period`}
          icon={Users}
          color="teal"
        />
        <StatCard
          label="Total Tasks"
          value={fmt.number(kpis.tasks.total)}
          sub={`${completionRate}% completion rate`}
          icon={ClipboardList}
          color="blue"
        />
        <StatCard
          label="Commission Revenue"
          value={fmt.money(kpis.revenue.total_commission ?? 0)}
          sub={`${kpis.revenue.deposit_count ?? 0} deposits`}
          icon={DollarSign}
          color="gold"
        />
        <StatCard
          label="Total Payouts"
          value={fmt.money(kpis.revenue.total_payouts ?? 0)}
          sub="To taskers"
          icon={TrendingUp}
          color="green"
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Customers',    value: kpis.users.customers,   color: 'text-teal-700   bg-teal-50',   icon: '👤' },
          { label: 'Taskers',      value: kpis.users.taskers,     color: 'text-gold-700   bg-yellow-50', icon: '🔧' },
          { label: 'In Progress',  value: kpis.tasks.in_progress, color: 'text-purple-700 bg-purple-50', icon: '⚡' },
          { label: 'Disputed',     value: kpis.tasks.disputed,    color: 'text-red-700    bg-red-50',    icon: '⚖️' },
        ].map(s => (
          <div key={s.label} className="card-sm flex items-center gap-3">
            <span className="text-2xl">{s.icon}</span>
            <div>
              <p className="text-xl font-extrabold text-navy-900">{fmt.number(s.value)}</p>
              <p className="text-xs text-navy-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts row 1 */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Revenue trend */}
        <div className="card">
          <h3 className="font-bold text-navy-800 mb-4">Revenue Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={charts.revenue}>
              <defs>
                <linearGradient id="gComm" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={TEAL}  stopOpacity={0.25}/>
                  <stop offset="95%" stopColor={TEAL}  stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="gDep" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={GOLD}  stopOpacity={0.2}/>
                  <stop offset="95%" stopColor={GOLD}  stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `${v}`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`NAD ${v?.toFixed(2)}`, '']} />
              <Legend />
              <Area type="monotone" dataKey="commission" name="Commission" stroke={TEAL} fill="url(#gComm)" strokeWidth={2} />
              <Area type="monotone" dataKey="deposits"   name="Deposits"   stroke={GOLD} fill="url(#gDep)"  strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Tasks trend */}
        <div className="card">
          <h3 className="font-bold text-navy-800 mb-4">Task Activity</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={charts.tasks}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Bar dataKey="total"     name="Posted"    fill={NAVY}  radius={[3,3,0,0]} />
              <Bar dataKey="completed" name="Completed" fill={GREEN} radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* User growth */}
        <div className="card">
          <h3 className="font-bold text-navy-800 mb-4">User Growth</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={charts.user_growth}>
              <defs>
                <linearGradient id="gUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={TEAL} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={TEAL} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="count" name="New Users" stroke={TEAL} fill="url(#gUsers)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Categories */}
        <div className="card">
          <h3 className="font-bold text-navy-800 mb-4">Top Categories</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={top_categories} dataKey="count" nameKey="category" cx="50%" cy="50%" outerRadius={70} paddingAngle={3}>
                {top_categories.map((_: unknown, i: number) => (
                  <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [v, name]} />
              <Legend formatter={v => <span style={{ fontSize: 11, color: '#475569' }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Payment providers */}
        <div className="card">
          <h3 className="font-bold text-navy-800 mb-3">Payment Providers</h3>
          <div className="space-y-3">
            {payment_providers?.map((p: any) => (
              <div key={`${p.provider}-${p.direction}`} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-navy-700 capitalize">
                    {p.provider.replace('_', ' ')} · {p.direction}
                  </p>
                  <p className="text-xs text-navy-400">{p.count} transactions · {p.failed} failed</p>
                </div>
                <p className="text-sm font-bold text-navy-900">{fmt.money(p.volume)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top taskers */}
      <div className="card">
        <h3 className="font-bold text-navy-800 mb-4">Top Taskers</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-navy-100">
                {['Tasker', 'Status', 'Tasks Completed', 'Total Earned', 'Rating'].map(h => (
                  <th key={h} className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {top_taskers.map((t: any, i: number) => (
                <tr key={t.id} className="tr">
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <span className="text-navy-400 text-xs w-4">{i + 1}</span>
                      <div className="w-7 h-7 rounded-full bg-teal-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {t.name?.[0]}
                      </div>
                      <span className="font-medium text-navy-800">{t.name}</span>
                    </div>
                  </td>
                  <td className="td">
                    <span className={t.verification_status === 'approved' ? 'badge-green' : 'badge-yellow'}>
                      {t.verification_status}
                    </span>
                  </td>
                  <td className="td font-semibold">{t.total_tasks_completed}</td>
                  <td className="td font-semibold text-teal-700">{fmt.money(t.total_earnings)}</td>
                  <td className="td">
                    <span className="text-yellow-600 font-semibold">★ {parseFloat(t.rating).toFixed(1)}</span>
                    <span className="text-navy-400 text-xs ml-1">({t.rating_count})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
