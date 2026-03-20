import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, FlatList, RefreshControl, Linking, ActivityIndicator,
  Animated, TextInput, Platform,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { walletApi, paymentsApi, Wallet, Transaction } from '../../src/services/api';
import { useAuthStore } from '../../src/store/authStore';
import {
  Button, Input, Card, LoadingSpinner, Divider,
  Badge, StatCard, SectionHeader, RowItem,
} from '../../src/components/common';
import {
  Colors, FontSize, FontWeight, Spacing, Radius, Shadow,
} from '../../src/constants/theme';
import { format, formatDistanceToNow } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

type ModalView = 'deposit_provider' | 'deposit_form' | 'withdraw_form' | 'deposit_pending' | null;
type Provider  = 'fnb_ewallet' | 'bank_windhoek';
type TxFilter  = 'all' | 'deposit' | 'withdrawal' | 'escrow_hold' | 'payout';

// ─── Constants ────────────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    id:    'fnb_ewallet' as Provider,
    name:  'FNB eWallet',
    short: 'FNB',
    desc:  'Approve via SMS on your FNB eWallet',
    icon:  '🏦',
    color: Colors.teal,
    minDeposit: 10,
    fee:   'Free',
  },
  {
    id:    'bank_windhoek' as Provider,
    name:  'Bank Windhoek',
    short: 'BWK',
    desc:  'Pay via Bank Windhoek checkout',
    icon:  '🏛️',
    color: Colors.gold,
    minDeposit: 10,
    fee:   'Free',
  },
];

const TX_FILTERS: { key: TxFilter; label: string }[] = [
  { key: 'all',        label: 'All' },
  { key: 'deposit',    label: 'Deposits' },
  { key: 'payout',     label: 'Payouts' },
  { key: 'withdrawal', label: 'Withdrawals' },
  { key: 'escrow_hold',label: 'Escrow' },
];

const TX_CONFIG: Record<string, { icon: string; color: string; label: string; credit: boolean }> = {
  deposit:        { icon: 'arrow-down-circle',   color: Colors.success,  label: 'Deposit',    credit: true  },
  withdrawal:     { icon: 'arrow-up-circle',     color: Colors.error,    label: 'Withdrawal', credit: false },
  escrow_hold:    { icon: 'lock-closed',          color: Colors.warning,  label: 'Escrow Hold',credit: false },
  escrow_release: { icon: 'lock-open',            color: Colors.success,  label: 'Released',   credit: true  },
  payout:         { icon: 'cash',                 color: Colors.success,  label: 'Payout',     credit: true  },
  commission:     { icon: 'cut-outline',           color: Colors.gray400,  label: 'Commission', credit: false },
  refund:         { icon: 'return-up-back',        color: Colors.info,     label: 'Refund',     credit: true  },
};

// ─── Polling hook ─────────────────────────────────────────────────────────────

const useDepositPoller = (reference: string | null, onComplete: (status: string) => void) => {
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!reference) return;

    let attempts = 0;
    intervalRef.current = setInterval(async () => {
      attempts++;
      try {
        const res  = await paymentsApi.verify(reference);
        const data = res.data.data;

        if (data.status === 'completed') {
          clearInterval(intervalRef.current);
          onComplete('completed');
        } else if (['failed', 'cancelled'].includes(data.status)) {
          clearInterval(intervalRef.current);
          onComplete(data.status);
        } else if (attempts >= 60) {
          // 5 min timeout
          clearInterval(intervalRef.current);
          onComplete('timeout');
        }
      } catch {}
    }, 5000);

    return () => clearInterval(intervalRef.current);
  }, [reference]);
};

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function WalletTab() {
  const { user }   = useAuthStore();
  const qc         = useQueryClient();

  const [modal,   setModal]    = useState<ModalView>(null);
  const [provider, setProvider] = useState<Provider>('fnb_ewallet');
  const [amount,   setAmount]   = useState('');
  const [phone,    setPhone]    = useState(user?.phone ?? '');
  const [accNum,   setAccNum]   = useState('');
  const [accName,  setAccName]  = useState(user?.name ?? '');
  const [txFilter, setTxFilter] = useState<TxFilter>('all');
  const [pendingRef, setPendingRef] = useState<string | null>(null);

  // Deposit polling
  useDepositPoller(pendingRef, (status) => {
    setPendingRef(null);
    setModal(null);
    if (status === 'completed') {
      showMessage({ message: '💰 Deposit successful!', description: 'Your wallet has been topped up.', type: 'success', duration: 4000 });
      qc.invalidateQueries({ queryKey: ['wallet'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    } else {
      showMessage({ message: `Payment ${status}`, description: 'Please try again.', type: 'danger' });
    }
  });

  // Queries
  const { data: walletData, isLoading: wLoading, refetch: wRefetch } = useQuery({
    queryKey: ['wallet'],
    queryFn:  () => walletApi.get(),
    select:   r => r.data.data as Wallet,
    refetchInterval: pendingRef ? 5000 : false,
  });

  const { data: txData = [], isLoading: txLoading, refetch: txRefetch } = useQuery({
    queryKey: ['transactions', txFilter],
    queryFn:  () => walletApi.transactions({ limit: 50, ...(txFilter !== 'all' ? { type: txFilter } : {}) }),
    select:   r => r.data.data as Transaction[],
  });

  const { data: summary } = useQuery({
    queryKey: ['payment-summary'],
    queryFn:  () => paymentsApi.history({ limit: 1 }),
    select:   r => r.data.data,
  });

  // Deposit mutation
  const depositMut = useMutation({
    mutationFn: () => paymentsApi.initiate({ amount: parseFloat(amount), provider, phone: phone.replace(/\s/g, '') }),
    onSuccess: (res) => {
      const data = res.data.data;
      setPendingRef(data.reference);
      setModal('deposit_pending');

      if (data.checkout_url) {
        Linking.openURL(data.checkout_url).catch(() => {});
      }

      // Dev: auto-complete mock after 3s
      if (data.mock) {
        setTimeout(async () => {
          try {
            await fetch(`${require('../../src/services/api').BASE_URL.replace('/api/v1','')}/api/v1/dev/payments/mock-complete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reference: data.reference, simulate: 'completed' }),
            });
          } catch {}
        }, 3000);
      }
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Deposit failed', type: 'danger' }),
  });

  // Withdrawal mutation
  const withdrawMut = useMutation({
    mutationFn: () => paymentsApi.initiate({
      amount: parseFloat(amount), provider, phone: phone.replace(/\s/g, ''),
    }),
    // In real app this calls /payments/withdraw endpoint — using deposit for mock simplicity
    onSuccess: () => {
      showMessage({ message: 'Withdrawal submitted', description: 'Funds will arrive within 24h.', type: 'success' });
      setModal(null); setAmount('');
      qc.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (e: any) => showMessage({ message: e?.response?.data?.message ?? 'Withdrawal failed', type: 'danger' }),
  });

  const balance        = parseFloat(walletData?.balance ?? '0');
  const escrowBalance  = parseFloat(walletData?.escrow_balance ?? '0');
  const totalEarned    = parseFloat(walletData?.total_earned ?? '0');
  const selectedProv   = PROVIDERS.find(p => p.id === provider)!;

  const handleDeposit = () => {
    if (!amount || parseFloat(amount) < 10) { showMessage({ message: 'Minimum deposit is NAD 10', type: 'warning' }); return; }
    depositMut.mutate();
  };

  const handleWithdraw = () => {
    if (!amount || parseFloat(amount) < 20) { showMessage({ message: 'Minimum withdrawal is NAD 20', type: 'warning' }); return; }
    if (parseFloat(amount) > balance) { showMessage({ message: 'Insufficient balance', type: 'danger' }); return; }
    withdrawMut.mutate();
  };

  const refetch = useCallback(() => { wRefetch(); txRefetch(); }, []);

  if (wLoading) return <LoadingSpinner fullScreen message="Loading wallet…" />;

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={wLoading} onRefresh={refetch} tintColor={Colors.teal} />}
      >
        {/* ── Balance hero ─────────────────────────────────────────────────── */}
        <View style={styles.hero}>
          {/* Decorative circles */}
          <View style={[styles.blob, styles.blob1]} />
          <View style={[styles.blob, styles.blob2]} />

          <Text style={styles.heroLabel}>Available Balance</Text>
          <Text style={styles.heroBalance}>
            <Text style={styles.heroCur}>NAD </Text>
            {balance.toLocaleString('en-NA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>

          {escrowBalance > 0 && (
            <View style={styles.escrowChip}>
              <Ionicons name="lock-closed-outline" size={13} color={Colors.gold} />
              <Text style={styles.escrowText}>NAD {escrowBalance.toFixed(2)} in escrow</Text>
            </View>
          )}

          {/* Action buttons */}
          <View style={styles.heroActions}>
            <TouchableOpacity style={[styles.heroBtn, { backgroundColor: Colors.gold }]}
              onPress={() => { setAmount(''); setModal('deposit_provider'); }}>
              <Ionicons name="add" size={20} color={Colors.navy} />
              <Text style={[styles.heroBtnText, { color: Colors.navy }]}>Top Up</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.heroBtn, { backgroundColor: Colors.white + '20', borderWidth: 1, borderColor: Colors.white + '40' }]}
              onPress={() => { setAmount(''); setModal('withdraw_form'); }}>
              <Ionicons name="arrow-up" size={20} color={Colors.white} />
              <Text style={styles.heroBtnText}>Withdraw</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Stats ────────────────────────────────────────────────────────── */}
        {user?.role === 'tasker' && (
          <View style={styles.statsRow}>
            <StatCard label="Total Earned" value={`NAD ${totalEarned.toFixed(0)}`} icon="cash-outline" color={Colors.success} />
            <View style={{ width: Spacing.sm }} />
            <StatCard label="In Escrow" value={`NAD ${escrowBalance.toFixed(0)}`} icon="lock-closed-outline" color={Colors.warning} />
          </View>
        )}

        {/* ── Providers info ────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Payment Methods" />
          <View style={styles.providerCards}>
            {PROVIDERS.map(p => (
              <View key={p.id} style={styles.providerCard}>
                <Text style={styles.providerIcon}>{p.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.providerName}>{p.name}</Text>
                  <Text style={styles.providerDesc}>{p.desc}</Text>
                </View>
                <View style={[styles.providerBadge, { backgroundColor: p.color + '15' }]}>
                  <Text style={[styles.providerBadgeText, { color: p.color }]}>Active</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ── Transactions ─────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Transactions" />

          {/* Filter tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: 7 }}>
              {TX_FILTERS.map(f => (
                <TouchableOpacity
                  key={f.key}
                  onPress={() => setTxFilter(f.key)}
                  style={[styles.txFilter, txFilter === f.key && styles.txFilterActive]}
                >
                  <Text style={[styles.txFilterText, txFilter === f.key && styles.txFilterTextActive]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {txLoading ? (
            <LoadingSpinner message="Loading transactions…" />
          ) : txData.length === 0 ? (
            <View style={styles.emptyTx}>
              <Ionicons name="receipt-outline" size={40} color={Colors.gray300} />
              <Text style={styles.emptyTxText}>No transactions yet</Text>
              <Text style={styles.emptyTxSub}>Top up your wallet to get started</Text>
            </View>
          ) : (
            txData.map(tx => <TransactionRow key={tx.id} tx={tx} />)
          )}
        </View>
      </ScrollView>

      {/* ══ MODALS ════════════════════════════════════════════════════════════ */}

      {/* Provider picker */}
      <Modal visible={modal === 'deposit_provider'} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.sheet}>
            <ModalHeader title="Choose Payment Method" onClose={() => setModal(null)} />
            <Text style={styles.sheetSub}>Select how you want to top up your wallet</Text>

            {PROVIDERS.map(p => (
              <TouchableOpacity
                key={p.id}
                style={[styles.providerOption, provider === p.id && { borderColor: p.color, backgroundColor: p.color + '08' }]}
                onPress={() => { setProvider(p.id); setModal('deposit_form'); }}
                activeOpacity={0.8}
              >
                <Text style={styles.providerOptionIcon}>{p.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.providerOptionName}>{p.name}</Text>
                  <Text style={styles.providerOptionDesc}>{p.desc}</Text>
                  <Text style={[styles.providerOptionFee, { color: Colors.success }]}>Fee: {p.fee} · Min NAD {p.minDeposit}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.gray300} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* Deposit form */}
      <Modal visible={modal === 'deposit_form'} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.sheet}>
            <ModalHeader
              title={`Deposit via ${selectedProv.name}`}
              onClose={() => setModal('deposit_provider')}
              backIcon
            />

            <View style={[styles.providerBanner, { backgroundColor: selectedProv.color + '12', borderColor: selectedProv.color + '30' }]}>
              <Text style={styles.providerBannerIcon}>{selectedProv.icon}</Text>
              <Text style={[styles.providerBannerName, { color: selectedProv.color }]}>{selectedProv.name}</Text>
            </View>

            <Input
              label="Amount (NAD)"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              icon="cash-outline"
              placeholder="Enter amount (min NAD 10)"
              hint={`Max single deposit: NAD 50,000`}
            />

            <Input
              label="Phone Number"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              icon="call-outline"
              placeholder="+264 81 XXX XXXX"
              hint={
                provider === 'fnb_ewallet'
                  ? "You'll receive an SMS approval request"
                  : "Used to identify your Bank Windhoek account"
              }
            />

            {/* Escrow info */}
            <View style={styles.infoBox}>
              <Ionicons name="shield-checkmark-outline" size={16} color={Colors.teal} />
              <Text style={styles.infoBoxText}>
                Funds are protected. Money is only released to taskers after you confirm task completion.
              </Text>
            </View>

            <Button
              title={`Pay NAD ${amount || '0'} via ${selectedProv.short}`}
              onPress={handleDeposit}
              loading={depositMut.isPending}
              variant="gold"
              icon="arrow-forward"
              iconRight
            />
          </View>
        </View>
      </Modal>

      {/* Pending / polling */}
      <Modal visible={modal === 'deposit_pending'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.sheet, { alignItems: 'center', paddingTop: Spacing.xl }]}>
            <View style={styles.pendingSpinner}>
              <ActivityIndicator size="large" color={Colors.teal} />
            </View>
            <Text style={styles.pendingTitle}>Waiting for Payment</Text>
            <Text style={styles.pendingSub}>
              {provider === 'fnb_ewallet'
                ? 'Check your phone for an SMS from FNB to approve this payment'
                : 'Complete the payment on the Bank Windhoek page that opened in your browser'}
            </Text>
            <View style={styles.pendingSteps}>
              {(provider === 'fnb_ewallet'
                ? ['Open FNB app or SMS', 'Approve the payment request', 'Return here automatically']
                : ['Complete payment on browser page', 'Come back to Nam Task', 'Wallet updates automatically']
              ).map((step, i) => (
                <View key={i} style={styles.pendingStep}>
                  <View style={[styles.pendingStepNum, { backgroundColor: Colors.teal }]}>
                    <Text style={styles.pendingStepNumText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.pendingStepText}>{step}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity onPress={() => setModal(null)} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Withdrawal form */}
      <Modal visible={modal === 'withdraw_form'} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.sheet}>
            <ModalHeader title="Withdraw Funds" onClose={() => setModal(null)} />

            <View style={styles.balanceChip}>
              <Text style={styles.balanceChipLabel}>Available</Text>
              <Text style={styles.balanceChipValue}>NAD {balance.toFixed(2)}</Text>
            </View>

            {/* Provider selector */}
            <Text style={styles.fieldLabel}>Withdraw via</Text>
            <View style={styles.providerPillRow}>
              {PROVIDERS.map(p => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setProvider(p.id)}
                  style={[styles.providerPill, provider === p.id && { backgroundColor: p.color, borderColor: p.color }]}
                >
                  <Text>{p.icon}</Text>
                  <Text style={[styles.providerPillText, provider === p.id && { color: Colors.white }]}>{p.short}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Amount (NAD)"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              icon="cash-outline"
              placeholder="Min NAD 20"
              hint="NAD 5.00 processing fee applies"
            />

            {provider === 'fnb_ewallet' ? (
              <Input label="FNB eWallet Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" icon="call-outline" placeholder="+264 81 XXX XXXX" />
            ) : (
              <>
                <Input label="Account Number" value={accNum} onChangeText={setAccNum} keyboardType="numeric" icon="card-outline" placeholder="Enter BWK account number" />
                <Input label="Account Holder Name" value={accName} onChangeText={setAccName} icon="person-outline" />
              </>
            )}

            {amount && parseFloat(amount) >= 20 && (
              <View style={styles.withdrawSummary}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Withdrawal amount</Text>
                  <Text style={styles.summaryValue}>NAD {parseFloat(amount).toFixed(2)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Processing fee</Text>
                  <Text style={styles.summaryValue}>−NAD 5.00</Text>
                </View>
                <View style={[styles.summaryRow, styles.summaryTotal]}>
                  <Text style={styles.summaryTotalLabel}>You receive</Text>
                  <Text style={styles.summaryTotalValue}>NAD {(parseFloat(amount) - 5).toFixed(2)}</Text>
                </View>
              </View>
            )}

            <Button
              title="Submit Withdrawal"
              onPress={handleWithdraw}
              loading={withdrawMut.isPending}
              variant="primary"
              icon="arrow-up"
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TransactionRow({ tx }: { tx: Transaction }) {
  const cfg    = TX_CONFIG[tx.type] ?? { icon: 'swap-horizontal', color: Colors.gray400, label: tx.type, credit: false };
  const amount = parseFloat(String(tx.amount));

  return (
    <View style={txStyles.row}>
      <View style={[txStyles.iconWrap, { backgroundColor: cfg.color + '15' }]}>
        <Ionicons name={cfg.icon as any} size={19} color={cfg.color} />
      </View>
      <View style={txStyles.info}>
        <Text style={txStyles.type}>{cfg.label}</Text>
        {tx.task_title && (
          <Text style={txStyles.task} numberOfLines={1}>{tx.task_title}</Text>
        )}
        <Text style={txStyles.date}>
          {formatDistanceToNow(new Date(tx.created_at), { addSuffix: true })}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[txStyles.amount, { color: cfg.credit ? Colors.success : Colors.error }]}>
          {cfg.credit ? '+' : '−'} NAD {amount.toFixed(2)}
        </Text>
        <Text style={txStyles.balance}>Bal: {parseFloat(String(tx.balance_after)).toFixed(2)}</Text>
      </View>
    </View>
  );
}

function ModalHeader({
  title, onClose, backIcon = false,
}: {
  title: string; onClose: () => void; backIcon?: boolean;
}) {
  return (
    <View style={headerStyles.row}>
      <TouchableOpacity onPress={onClose} style={headerStyles.btn}>
        <Ionicons name={backIcon ? 'arrow-back' : 'close'} size={22} color={Colors.gray600} />
      </TouchableOpacity>
      <Text style={headerStyles.title}>{title}</Text>
      <View style={{ width: 36 }} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:           { flex: 1, backgroundColor: Colors.surface },

  hero:                { backgroundColor: Colors.navy, paddingTop: 56, paddingBottom: 32, paddingHorizontal: Spacing.lg, alignItems: 'center', overflow: 'hidden', position: 'relative' },
  blob:                { position: 'absolute', borderRadius: 999, opacity: 0.06, backgroundColor: Colors.teal },
  blob1:               { width: 220, height: 220, top: -80, left: -60 },
  blob2:               { width: 160, height: 160, bottom: -60, right: -30 },
  heroLabel:           { fontSize: FontSize.sm, color: Colors.gray400, marginBottom: 6 },
  heroBalance:         { fontSize: FontSize.huge, fontWeight: FontWeight.black, color: Colors.white },
  heroCur:             { fontSize: FontSize.xl, fontWeight: FontWeight.medium, color: Colors.gray400 },
  escrowChip:          { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: Colors.goldGlass, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full },
  escrowText:          { fontSize: FontSize.xs, color: Colors.gold, fontWeight: FontWeight.semibold },
  heroActions:         { flexDirection: 'row', gap: 12, marginTop: Spacing.lg },
  heroBtn:             { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: Radius.xl },
  heroBtnText:         { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.white },

  statsRow:            { flexDirection: 'row', padding: Spacing.lg, paddingTop: Spacing.md, backgroundColor: Colors.navyMid },
  section:             { padding: Spacing.lg },

  providerCards:       { gap: Spacing.sm },
  providerCard:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.white, padding: Spacing.md, borderRadius: Radius.xl, ...Shadow.sm },
  providerIcon:        { fontSize: 28 },
  providerName:        { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray800 },
  providerDesc:        { fontSize: FontSize.xs, color: Colors.gray400, marginTop: 2 },
  providerBadge:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  providerBadgeText:   { fontSize: FontSize.xs, fontWeight: FontWeight.bold },

  txFilter:            { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: Colors.gray100, borderWidth: 1, borderColor: Colors.border },
  txFilterActive:      { backgroundColor: Colors.teal, borderColor: Colors.teal },
  txFilterText:        { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.gray500 },
  txFilterTextActive:  { color: Colors.white },
  emptyTx:             { alignItems: 'center', gap: 8, paddingVertical: Spacing.xl },
  emptyTxText:         { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray500 },
  emptyTxSub:          { fontSize: FontSize.sm, color: Colors.gray300 },

  // Modal / sheet
  modalOverlay:        { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  sheet:               { backgroundColor: Colors.white, borderTopLeftRadius: Radius.xxl, borderTopRightRadius: Radius.xxl, padding: Spacing.lg, paddingBottom: Platform.OS === 'ios' ? 36 : Spacing.lg, maxHeight: '92%' },
  sheetSub:            { fontSize: FontSize.sm, color: Colors.gray400, marginBottom: Spacing.lg, textAlign: 'center' },

  providerOption:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.xl, borderWidth: 2, borderColor: Colors.border, marginBottom: Spacing.sm },
  providerOptionIcon:  { fontSize: 32 },
  providerOptionName:  { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.gray800 },
  providerOptionDesc:  { fontSize: FontSize.sm, color: Colors.gray500, marginTop: 2 },
  providerOptionFee:   { fontSize: FontSize.xs, marginTop: 4, fontWeight: FontWeight.medium },

  providerBanner:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderWidth: 1.5, borderRadius: Radius.xl, padding: Spacing.sm, marginBottom: Spacing.md },
  providerBannerIcon:  { fontSize: 24 },
  providerBannerName:  { fontSize: FontSize.base, fontWeight: FontWeight.bold },

  infoBox:             { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.tealXLight, padding: Spacing.md, borderRadius: Radius.lg, marginBottom: Spacing.md },
  infoBoxText:         { flex: 1, fontSize: FontSize.xs, color: Colors.tealDark, lineHeight: 18 },

  pendingSpinner:      { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.tealXLight, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.lg },
  pendingTitle:        { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.gray900, marginBottom: 8 },
  pendingSub:          { fontSize: FontSize.md, color: Colors.gray500, textAlign: 'center', lineHeight: 22, marginBottom: Spacing.lg },
  pendingSteps:        { alignSelf: 'stretch', gap: 12, marginBottom: Spacing.xl },
  pendingStep:         { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pendingStepNum:      { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  pendingStepNumText:  { color: Colors.white, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  pendingStepText:     { fontSize: FontSize.sm, color: Colors.gray600, flex: 1 },
  cancelBtn:           { paddingVertical: 12 },
  cancelBtnText:       { fontSize: FontSize.md, color: Colors.gray400 },

  balanceChip:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.tealXLight, padding: Spacing.md, borderRadius: Radius.lg, marginBottom: Spacing.md },
  balanceChipLabel:    { fontSize: FontSize.sm, color: Colors.tealDark, fontWeight: FontWeight.medium },
  balanceChipValue:    { fontSize: FontSize.lg, fontWeight: FontWeight.extrabold, color: Colors.teal },

  fieldLabel:          { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700, marginBottom: Spacing.sm },
  providerPillRow:     { flexDirection: 'row', gap: 10, marginBottom: Spacing.md },
  providerPill:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: Radius.xl, borderWidth: 2, borderColor: Colors.border, backgroundColor: Colors.white },
  providerPillText:    { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray600 },

  withdrawSummary:     { backgroundColor: Colors.gray50, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md, gap: 8 },
  summaryRow:          { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel:        { fontSize: FontSize.sm, color: Colors.gray500 },
  summaryValue:        { fontSize: FontSize.sm, color: Colors.gray700, fontWeight: FontWeight.medium },
  summaryTotal:        { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 8, marginTop: 4 },
  summaryTotalLabel:   { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.gray800 },
  summaryTotalValue:   { fontSize: FontSize.base, fontWeight: FontWeight.extrabold, color: Colors.teal },
});

const txStyles = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  iconWrap: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  info:     { flex: 1 },
  type:     { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray800, textTransform: 'capitalize' },
  task:     { fontSize: FontSize.xs, color: Colors.gray400, marginTop: 2 },
  date:     { fontSize: FontSize.xs, color: Colors.gray400, marginTop: 1 },
  amount:   { fontSize: FontSize.base, fontWeight: FontWeight.extrabold },
  balance:  { fontSize: FontSize.xs, color: Colors.gray300, marginTop: 2 },
});

const headerStyles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.lg },
  btn:   { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.gray100, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.gray900 },
});
