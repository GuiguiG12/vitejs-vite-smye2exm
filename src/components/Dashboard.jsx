import { useState, useEffect, useCallback } from 'react';
import { useDisconnect, useActiveWallet } from 'thirdweb/react';
import { getContract, readContract, prepareContractCall, sendTransaction } from 'thirdweb';
import { createThirdwebClient } from 'thirdweb';
import { arbitrum, base } from 'thirdweb/chains';
import { AreaChart, Area, Tooltip, ResponsiveContainer, XAxis, YAxis } from 'recharts';

const client = createThirdwebClient({ clientId: 'ef76c96ae163aba05ebd7e20d94b81fd' });

// API Endpoints
const VAULT_API_URL = 'https://ucrvaqztvfnphhoqcbpo.supabase.co/functions/v1/FIRECRAWL_DATA';
const REDEMPTION_API_URL = 'https://ucrvaqztvfnphhoqcbpo.supabase.co/functions/v1/REDEMPTION_API';

// ========== REAL ENZYME VAULT CONFIGURATION ==========
const ENZYME_VAULTS = {
  arb: {
    name: 'DeFi Yield',
    network: 'Arbitrum',
    vaultProxy: '0xc9e50e08739a4aec211f2e8e95f1ab45b923cc20',
    denominationAsset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    chain: arbitrum,
    color: '#E85A04',
    enzymeUrl: 'https://app.enzyme.finance/vault/0xc9e50e08739a4aec211f2e8e95f1ab45b923cc20?network=arbitrum',
    icon: '/favicon_arbitrum.svg',
    emoji: '📈'
  },
  base: {
    name: 'Stable Yield',
    network: 'Base',
    vaultProxy: '0xbfa811e1f065c9b66b02d8ae408d4d9b9be70a22',
    denominationAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    chain: base,
    color: '#0052FF',
    enzymeUrl: 'https://app.enzyme.finance/vault/0xbfa811e1f065c9b66b02d8ae408d4d9b9be70a22?network=base',
    icon: '/favicon_base.jpeg',
    emoji: '🛡️'
  }
};

// Minimal ABIs
const VAULT_ABI = [
  { name: 'getAccessor', type: 'function', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
];

const COMPTROLLER_ABI = [
  { name: 'buyShares', type: 'function', inputs: [{ name: '_investmentAmount', type: 'uint256' }, { name: '_minSharesQuantity', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'nonpayable' },
  { name: 'redeemSharesForSpecificAssets', type: 'function', inputs: [{ name: '_recipient', type: 'address' }, { name: '_sharesQuantity', type: 'uint256' }, { name: '_payoutAssets', type: 'address[]' }, { name: '_payoutAssetPercentages', type: 'uint256[]' }], outputs: [{ type: 'address[]' }, { type: 'uint256[]' }], stateMutability: 'nonpayable' },
];

const ERC20_ABI = [
  { name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
];

function Dashboard({ address }) {
  const { disconnect } = useDisconnect();
  const wallet = useActiveWallet();
  
  // UI State
  const [activePanel, setActivePanel] = useState('overview');
  const [theme, setTheme] = useState('dark');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notification, setNotification] = useState(null);
  
  // Data State
  const [vaultData, setVaultData] = useState({ arb: null, base: null });
  const [historyData, setHistoryData] = useState({ arb: [], base: [] });
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chartRange, setChartRange] = useState('1W');

  // User Balances
  const [userVaultBalances, setUserVaultBalances] = useState({ arb: 0n, base: 0n });
  const [userUsdcBalances, setUserUsdcBalances] = useState({ arb: 0n, base: 0n });
  const [comptrollerAddresses, setComptrollerAddresses] = useState({ arb: null, base: null });

  // Modal State
  const [depositModal, setDepositModal] = useState({ open: false, vault: 'arb' });
  const [redeemModal, setRedeemModal] = useState({ open: false, vault: 'arb' });
  const [depositAmount, setDepositAmount] = useState('');
  const [redeemAmount, setRedeemAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Redemption Cooldown State (72h)
  const [pendingRedemptions, setPendingRedemptions] = useState({ arb: null, base: null });
  const [countdowns, setCountdowns] = useState({ arb: null, base: null });
  const [cooldownSeconds, setCooldownSeconds] = useState(259200); // 72 hours default

  // ========== FORMAT HELPERS ==========
  const fmtUsd = (v) => {
    if (v == null || isNaN(Number(v))) return '$—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(v));
  };

  const fmtSharePrice = (v) => {
    if (v == null || isNaN(Number(v))) return '$—';
    return '$' + Number(v).toFixed(Number(v) < 10 ? 4 : 2);
  };

  const fmtPercent = (v) => {
    if (v == null) return '—';
    const n = Number(v);
    if (isNaN(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  };

  const formatCountdown = (ms) => {
    if (ms <= 0) return 'Ready!';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const formatCooldownDisplay = () => {
    if (cooldownSeconds < 3600) return `${Math.floor(cooldownSeconds / 60)} minutes`;
    return `${Math.floor(cooldownSeconds / 3600)} hours`;
  };

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';

  const showNotification = (message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // ========== THEME EFFECT ==========
  useEffect(() => { 
    document.documentElement.setAttribute('data-theme', theme); 
  }, [theme]);

  // ========== REDEMPTION API FUNCTIONS ==========
  const fetchPendingRedemptions = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${REDEMPTION_API_URL}?action=pending&wallet=${address}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.cooldown_seconds) setCooldownSeconds(data.cooldown_seconds);
      const pending = { arb: null, base: null };
      for (const req of data.pending || []) {
        pending[req.vault] = req;
      }
      setPendingRedemptions(pending);
    } catch (err) {
      console.error('Failed to fetch pending redemptions:', err);
    }
  }, [address]);

  const createRedemptionRequest = async (vault, sharesAmount, estimatedUsdc) => {
    const res = await fetch(`${REDEMPTION_API_URL}?action=create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet_address: address, vault, shares_amount: sharesAmount, estimated_usdc_value: estimatedUsdc })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.request;
  };

  const updateRedemptionStatus = async (id, status, txHash = null) => {
    const res = await fetch(`${REDEMPTION_API_URL}?action=update`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, tx_hash: txHash })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.request;
  };

  // ========== DATA FETCHING ==========
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [arbRes, baseRes, arbHistRes, baseHistRes] = await Promise.all([
        fetch(`${VAULT_API_URL}?action=get&network=arbitrum`),
        fetch(`${VAULT_API_URL}?action=get&network=base`),
        fetch(`${VAULT_API_URL}?action=history&network=arbitrum`),
        fetch(`${VAULT_API_URL}?action=history&network=base`),
      ]);
      const [arbData, baseData, arbHist, baseHist] = await Promise.all([
        arbRes.json(), baseRes.json(), arbHistRes.json(), baseHistRes.json()
      ]);
      setVaultData({ arb: arbData, base: baseData });
      setHistoryData({ arb: arbHist, base: baseHist });

      // Process Chart Data
      if (arbHist && Array.isArray(arbHist)) {
        const formatted = arbHist.map(item => ({
          date: new Date(item.scraped_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          timestamp: new Date(item.scraped_at).getTime(),
          sharePrice: Number(item.share_price),
          aum: Number(item.aum)
        })).sort((a, b) => a.timestamp - b.timestamp);
        setChartData(formatted);
      }
    } catch (err) {
      console.error('Failed to fetch vault data:', err);
    }
    setLoading(false);
  }, []);

  // Fetch user balances from blockchain
  const fetchUserBalances = useCallback(async () => {
    if (!address) return;

    for (const [key, vault] of Object.entries(ENZYME_VAULTS)) {
      if (!vault.vaultProxy) continue;
      try {
        const vaultContract = getContract({ client, chain: vault.chain, address: vault.vaultProxy, abi: VAULT_ABI });
        const shareBalance = await readContract({ contract: vaultContract, method: 'balanceOf', params: [address] });
        const comptroller = await readContract({ contract: vaultContract, method: 'getAccessor', params: [] });
        
        const usdcContract = getContract({ client, chain: vault.chain, address: vault.denominationAsset, abi: ERC20_ABI });
        const usdcBalance = await readContract({ contract: usdcContract, method: 'balanceOf', params: [address] });

        setUserVaultBalances(prev => ({ ...prev, [key]: shareBalance }));
        setUserUsdcBalances(prev => ({ ...prev, [key]: usdcBalance }));
        setComptrollerAddresses(prev => ({ ...prev, [key]: comptroller }));
      } catch (err) {
        console.error(`Failed to fetch ${key} balances:`, err);
      }
    }
  }, [address]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { fetchUserBalances(); }, [fetchUserBalances]);
  useEffect(() => { fetchPendingRedemptions(); }, [fetchPendingRedemptions]);

  // Countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      const newCountdowns = { arb: null, base: null };
      for (const vault of ['arb', 'base']) {
        const pending = pendingRedemptions[vault];
        if (pending) {
          const remaining = new Date(pending.unlock_at).getTime() - Date.now();
          newCountdowns[vault] = remaining > 0 ? remaining : 0;
        }
      }
      setCountdowns(newCountdowns);
    }, 1000);
    return () => clearInterval(interval);
  }, [pendingRedemptions]);

  // ========== COMPUTED VALUES ==========
  const getUserVaultValue = (vaultKey) => {
    const shares = Number(userVaultBalances[vaultKey]) / 1e18;
    const sharePrice = vaultData[vaultKey]?.share_price || 1;
    return shares * sharePrice;
  };

  const totalBalance = getUserVaultValue('arb') + getUserVaultValue('base');
  const walletUsdc = (Number(userUsdcBalances.arb) + Number(userUsdcBalances.base)) / 1e6;

  // Filter chart data by range
  const getFilteredChartData = () => {
    const now = Date.now();
    const ranges = {
      '1W': 7 * 24 * 60 * 60 * 1000,
      '1M': 30 * 24 * 60 * 60 * 1000,
      'ALL': Infinity
    };
    const cutoff = now - ranges[chartRange];
    return chartData.filter(d => d.timestamp >= cutoff);
  };

  // ========== DEPOSIT FUNCTION ==========
  const handleDeposit = async () => {
    const vaultKey = depositModal.vault;
    const vault = ENZYME_VAULTS[vaultKey];
    
    if (!vault?.vaultProxy) {
      showNotification('This vault is not yet available', 'error');
      return;
    }
    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      showNotification('Please enter a valid amount', 'error');
      return;
    }

    setIsProcessing(true);
    try {
      const account = await wallet.getAccount();
      const amount = BigInt(Math.floor(parseFloat(depositAmount) * 1e6));

      if (userUsdcBalances[vaultKey] < amount) {
        showNotification('Insufficient USDC balance', 'error');
        setIsProcessing(false);
        return;
      }

      const comptrollerAddr = comptrollerAddresses[vaultKey];
      if (!comptrollerAddr) {
        showNotification('Could not find vault comptroller', 'error');
        setIsProcessing(false);
        return;
      }

      // Approve USDC
      const usdcContract = getContract({ client, chain: vault.chain, address: vault.denominationAsset, abi: ERC20_ABI });
      const approveTx = prepareContractCall({ contract: usdcContract, method: 'approve', params: [comptrollerAddr, amount] });
      await sendTransaction({ transaction: approveTx, account });

      // Buy Shares
      const comptrollerContract = getContract({ client, chain: vault.chain, address: comptrollerAddr, abi: COMPTROLLER_ABI });
      const depositTx = prepareContractCall({ contract: comptrollerContract, method: 'buyShares', params: [amount, 1n] });
      await sendTransaction({ transaction: depositTx, account });

      showNotification(`Successfully deposited ${depositAmount} USDC!`, 'success');
      setDepositModal({ open: false, vault: 'arb' });
      setDepositAmount('');
      fetchUserBalances();
    } catch (err) {
      console.error('Deposit error:', err);
      showNotification(err.message || 'Deposit failed', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // ========== REDEMPTION REQUEST ==========
  const handleRedemptionRequest = async () => {
    const vaultKey = redeemModal.vault;
    const vault = ENZYME_VAULTS[vaultKey];
    
    if (!vault?.vaultProxy) {
      showNotification('This vault is not yet available', 'error');
      return;
    }
    if (!redeemAmount || parseFloat(redeemAmount) <= 0) {
      showNotification('Please enter a valid amount', 'error');
      return;
    }

    const sharesAmount = parseFloat(redeemAmount);
    const userShares = Number(userVaultBalances[vaultKey]) / 1e18;
    
    if (sharesAmount > userShares) {
      showNotification('Insufficient vault shares', 'error');
      return;
    }

    setIsProcessing(true);
    try {
      const sharePrice = vaultData[vaultKey]?.share_price || 1;
      const estimatedUsdc = sharesAmount * sharePrice;
      const request = await createRedemptionRequest(vaultKey, sharesAmount, estimatedUsdc);
      setPendingRedemptions(prev => ({ ...prev, [vaultKey]: request }));
      showNotification(`Redemption request submitted! Withdrawal available in ${formatCooldownDisplay()}`, 'success');
      setRedeemAmount('');
    } catch (err) {
      console.error('Redemption request error:', err);
      showNotification(err.message || 'Failed to submit request', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // ========== EXECUTE REDEMPTION ==========
  const executeRedemption = async () => {
    const vaultKey = redeemModal.vault;
    const vault = ENZYME_VAULTS[vaultKey];
    const pending = pendingRedemptions[vaultKey];
    
    if (!pending || countdowns[vaultKey] > 0) {
      showNotification('Please wait for the cooldown to expire', 'error');
      return;
    }

    setIsProcessing(true);
    try {
      const account = await wallet.getAccount();
      const sharesAmount = BigInt(Math.floor(pending.shares_amount * 1e18));
      const comptrollerAddr = comptrollerAddresses[vaultKey];
      const comptrollerContract = getContract({ client, chain: vault.chain, address: comptrollerAddr, abi: COMPTROLLER_ABI });
      
      const redeemTx = prepareContractCall({
        contract: comptrollerContract,
        method: 'redeemSharesForSpecificAssets',
        params: [address, sharesAmount, [vault.denominationAsset], [10000n]]
      });
      const result = await sendTransaction({ transaction: redeemTx, account });
      await updateRedemptionStatus(pending.id, 'completed', result?.transactionHash);
      
      showNotification(`Successfully redeemed ${pending.shares_amount.toFixed(4)} shares!`, 'success');
      setRedeemModal({ open: false, vault: 'arb' });
      setPendingRedemptions(prev => ({ ...prev, [vaultKey]: null }));
      fetchUserBalances();
    } catch (err) {
      console.error('Redeem error:', err);
      showNotification(err.message || 'Redemption failed', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const cancelRedemption = async (vaultKey) => {
    const pending = pendingRedemptions[vaultKey];
    if (!pending) return;
    try {
      await updateRedemptionStatus(pending.id, 'cancelled');
      setPendingRedemptions(prev => ({ ...prev, [vaultKey]: null }));
      showNotification('Redemption request cancelled', 'info');
    } catch (err) {
      showNotification('Failed to cancel request', 'error');
    }
  };

  const handleLogout = async () => {
    if (wallet) await disconnect(wallet);
  };

  const hasPendingRedemption = (vaultKey) => !!pendingRedemptions[vaultKey];
  const isRedemptionReady = (vaultKey) => hasPendingRedemption(vaultKey) && countdowns[vaultKey] === 0;

  // ========== RENDER ==========
  return (
    <div className="dashboard-layout">
      {/* SIDEBAR */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <a href="/" className="logo-container">
            <img src="/logo_g12.svg" alt="G12" height="28" />
            <span className="logo-text">G12 LABS</span>
          </a>
        </div>

        <div className="nav-section">
          <div className="nav-label">Main Menu</div>
          <div className={`nav-item ${activePanel === 'overview' ? 'active' : ''}`} onClick={() => { setActivePanel('overview'); setMobileMenuOpen(false); }}>
            <i className="ph ph-squares-four"></i> Dashboard
          </div>
          <div className={`nav-item ${activePanel === 'buy-sell' ? 'active' : ''}`} onClick={() => { setActivePanel('buy-sell'); setMobileMenuOpen(false); }}>
            <i className="ph ph-arrows-left-right"></i> Buy / Sell
          </div>
          <div className={`nav-item ${activePanel === 'transactions' ? 'active' : ''}`} onClick={() => { setActivePanel('transactions'); setMobileMenuOpen(false); }}>
            <i className="ph ph-list-dashes"></i> Transactions
          </div>
        </div>

        <div className="nav-section">
          <div className="nav-label">Analytics</div>
          <a href="/strategies.html" className="nav-item">
            <i className="ph ph-chart-line-up"></i> Strategies
          </a>
        </div>

        <div className="nav-section">
          <div className="nav-label">Account</div>
          <div className={`nav-item ${activePanel === 'settings' ? 'active' : ''}`} onClick={() => { setActivePanel('settings'); setMobileMenuOpen(false); }}>
            <i className="ph ph-gear"></i> Settings
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="disconnect-btn" onClick={handleLogout}>
            <i className="ph ph-sign-out"></i> Disconnect
          </div>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {mobileMenuOpen && <div className="sidebar-overlay" onClick={() => setMobileMenuOpen(false)}></div>}

      {/* MAIN */}
      <main className="main-content">
        {/* Mobile Header */}
        <header className="mobile-header">
          <a href="/" className="mobile-brand">
            <img src="/logo_g12.svg" alt="G12" />
            <span>G12 LABS</span>
          </a>
          <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            <i className={`ph ${mobileMenuOpen ? 'ph-x' : 'ph-list'}`}></i>
          </button>
        </header>

        {/* Top Bar */}
        <header className="topbar">
          <div className="breadcrumbs">
            Dashboard <span style={{ margin: '0 6px' }}>/</span> 
            <span>{activePanel === 'overview' ? 'Overview' : activePanel === 'buy-sell' ? 'Buy / Sell' : activePanel === 'transactions' ? 'Transactions' : 'Settings'}</span>
          </div>
          <div className="topbar-right">
            <div className="refresh-btn" onClick={loadData} title="Refresh Data">
              <i className="ph ph-arrows-clockwise"></i>
            </div>

            <div className={`theme-toggle ${theme}`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              <div className="toggle-thumb">{theme === 'dark' ? '🌙' : '☀️'}</div>
            </div>

            <div className="wallet-capsule">
              <div className="wallet-avatar"></div>
              <span className="wallet-addr mono">{shortAddress}</span>
            </div>
          </div>
        </header>

        {/* Notification */}
        {notification && (
          <div className={`notification ${notification.type}`}>
            <i className={`ph ${notification.type === 'success' ? 'ph-check-circle' : notification.type === 'error' ? 'ph-x-circle' : 'ph-info'}`}></i>
            <span>{notification.message}</span>
          </div>
        )}

        <div className="content-wrapper">
          {/* ========== OVERVIEW PANEL ========== */}
          {activePanel === 'overview' && (
            <>
              <div className="row-top">
                {/* Portfolio Card */}
                <div className="glass-card portfolio-card">
                  <div className="p-header">
                    <h2>Total Portfolio</h2>
                    <div className="p-balance mono">{fmtUsd(totalBalance)}</div>
                    <div className="p-change">
                      <i className="ph ph-trend-up"></i>
                      APY {vaultData.arb ? fmtPercent(vaultData.arb.monthly_return * 12) : '—'}
                    </div>
                  </div>

                  {/* Chart */}
                  <div style={{ width: '100%', height: '180px', marginTop: 'auto' }}>
                    {loading ? (
                      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                        Syncing blockchain data...
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={getFilteredChartData()}>
                          <defs>
                            <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#E85A04" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#E85A04" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" hide />
                          <YAxis hide domain={['auto', 'auto']} />
                          <Tooltip
                            contentStyle={{ backgroundColor: 'var(--bg-root)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-main)' }}
                            itemStyle={{ color: 'var(--text-main)' }}
                            formatter={(value) => [fmtUsd(totalBalance > 0 ? value * (totalBalance / (vaultData.arb?.share_price || 1)) / 1000 : value * 1000), totalBalance > 0 ? 'Portfolio Value' : 'Strategy (Base 1000)']}
                            labelFormatter={(label) => label}
                          />
                          <Area
                            type="monotone"
                            dataKey="sharePrice"
                            stroke="#E85A04"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorVal)"
                            isAnimationActive={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>

                  {/* Chart Range Controls */}
                  <div className="chart-range-btns">
                    {['1W', '1M', 'ALL'].map(r => (
                      <button key={r} className={`range-btn ${chartRange === r ? 'active' : ''}`} onClick={() => setChartRange(r)}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Actions Card */}
                <div className="glass-card actions-card">
                  <div className="available-row">
                    <div>
                      <div className="av-label">Wallet Balance</div>
                      <div className="av-val mono" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <img src="/usd-coin-usdc-logo.png" width="24" height="24" alt="USDC" />
                        {fmtUsd(walletUsdc)}
                      </div>
                    </div>
                  </div>
                  <div className="action-btns">
                    <button className="act-btn primary" onClick={() => setDepositModal({ open: true, vault: 'arb' })}>
                      <i className="ph ph-arrow-down"></i> Deposit
                    </button>
                    <button className="act-btn" onClick={() => setRedeemModal({ open: true, vault: 'arb' })}>
                      <i className="ph ph-arrow-up"></i> Withdraw
                    </button>
                  </div>
                </div>
              </div>

              <div className="row-bottom">
                {/* Positions */}
                <div className="section-col">
                  <div className="section-title"><i className="ph ph-wallet"></i> Your Positions</div>
                  {totalBalance > 0 ? (
                    <div className="positions-list">
                      {Object.entries(ENZYME_VAULTS).map(([key, vault]) => (
                        <div className="pos-item" key={key} onClick={() => setActivePanel('buy-sell')}>
                          <div className="pos-main">
                            <img src={vault.icon} className="pos-icon" alt={vault.name} />
                            <div className="pos-info">
                              <h4>{vault.name}</h4>
                              <span>{vault.network}</span>
                            </div>
                          </div>
                          <div className="pos-stats">
                            <div className="pos-stat-grp">
                              <label>APY</label>
                              <span className="pos-apy">{vaultData[key] ? fmtPercent(vaultData[key].monthly_return * 12) : '—'}</span>
                            </div>
                            <div className="pos-stat-grp">
                              <label>Balance</label>
                              <span className="mono">{fmtUsd(getUserVaultValue(key))}</span>
                            </div>
                            {hasPendingRedemption(key) && (
                              <div className="pos-stat-grp">
                                <label>Status</label>
                                <span className="pending-badge">
                                  <i className="ph ph-clock"></i>
                                  {isRedemptionReady(key) ? 'Ready' : formatCountdown(countdowns[key])}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-box">
                      <i className="ph ph-safe"></i>
                      <p>No active positions. Deploy capital to start generating yield.</p>
                    </div>
                  )}
                </div>

                {/* Recent Activity */}
                <div className="section-col">
                  <div className="section-title"><i className="ph ph-clock-counter-clockwise"></i> Recent Activity</div>
                  <div className="glass-card" style={{ padding: '0 16px', minHeight: '200px' }}>
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                      <i className="ph ph-scroll" style={{ fontSize: '24px', marginBottom: '10px', opacity: 0.5 }}></i>
                      No recent transactions found on-chain.
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ========== BUY / SELL PANEL ========== */}
          {activePanel === 'buy-sell' && (
            <div className="vault-grid">
              {Object.entries(ENZYME_VAULTS).map(([key, vault]) => (
                <div className="vault-card" key={key}>
                  <div className="vc-header">
                    <div className="vc-title">
                      <img src={vault.icon} width="32" alt={vault.name} />
                      {vault.name}
                    </div>
                    <div className="vc-badges">
                      <span className="badge">{vault.network}</span>
                      {hasPendingRedemption(key) && (
                        <span className="badge warning">
                          <i className="ph ph-clock"></i>
                          {isRedemptionReady(key) ? 'Ready' : formatCountdown(countdowns[key])}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="vc-stats">
                    <div className="vc-stat">
                      <label>Share Price</label>
                      <span className="mono">{fmtSharePrice(vaultData[key]?.share_price)}</span>
                    </div>
                    <div className="vc-stat">
                      <label>Net APY</label>
                      <span style={{ color: 'var(--success)' }}>{vaultData[key] ? fmtPercent(vaultData[key].monthly_return * 12) : '—'}</span>
                    </div>
                    <div className="vc-stat">
                      <label>Your Balance</label>
                      <span className="mono">{fmtUsd(getUserVaultValue(key))}</span>
                    </div>
                    <div className="vc-stat">
                      <label>Your Shares</label>
                      <span className="mono">{(Number(userVaultBalances[key]) / 1e18).toFixed(4)}</span>
                    </div>
                    <div className="vc-stat">
                      <label>Total AUM</label>
                      <span className="mono">{fmtUsd(vaultData[key]?.aum)}</span>
                    </div>
                    <div className="vc-stat">
                      <label>Depositors</label>
                      <span>{vaultData[key]?.depositors ?? '—'}</span>
                    </div>
                  </div>

                  {/* Pending Redemption Info */}
                  {hasPendingRedemption(key) && (
                    <div className={`redemption-status ${isRedemptionReady(key) ? 'ready' : 'pending'}`}>
                      <div className="status-header">
                        <i className={`ph ${isRedemptionReady(key) ? 'ph-check-circle' : 'ph-clock'}`}></i>
                        <span>{isRedemptionReady(key) ? 'Withdrawal Ready!' : 'Pending Redemption'}</span>
                      </div>
                      <div className="status-details">
                        <div className="detail">
                          <span>Shares:</span>
                          <strong>{pendingRedemptions[key]?.shares_amount.toFixed(4)}</strong>
                        </div>
                        <div className="detail">
                          <span>Est. Value:</span>
                          <strong>{fmtUsd(pendingRedemptions[key]?.estimated_usdc_value)}</strong>
                        </div>
                        {!isRedemptionReady(key) && (
                          <div className="detail">
                            <span>Time Left:</span>
                            <strong className="countdown">{formatCountdown(countdowns[key])}</strong>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="vc-actions">
                    <button className="btn btn-primary" onClick={() => setDepositModal({ open: true, vault: key })}>
                      <i className="ph ph-plus"></i> Deposit
                    </button>
                    {hasPendingRedemption(key) ? (
                      isRedemptionReady(key) ? (
                        <button className="btn btn-success" onClick={() => setRedeemModal({ open: true, vault: key })}>
                          <i className="ph ph-check"></i> Complete Withdrawal
                        </button>
                      ) : (
                        <button className="btn btn-warning" onClick={() => cancelRedemption(key)}>
                          <i className="ph ph-x"></i> Cancel Request
                        </button>
                      )
                    ) : (
                      <button className="btn btn-secondary" onClick={() => setRedeemModal({ open: true, vault: key })}>
                        <i className="ph ph-minus"></i> Redeem
                      </button>
                    )}
                  </div>

                  <a href={vault.enzymeUrl} target="_blank" rel="noreferrer" className="vault-link">
                    <i className="ph ph-arrow-square-out"></i> View on Enzyme Finance
                  </a>
                </div>
              ))}
            </div>
          )}

          {/* ========== TRANSACTIONS PANEL ========== */}
          {activePanel === 'transactions' && (
            <div className="glass-card" style={{ padding: 0 }}>
              <table className="full-tx-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Vault</th>
                    <th>Amount</th>
                    <th>Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan="5" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <i className="ph ph-scroll" style={{ fontSize: '24px', marginBottom: '10px', display: 'block', opacity: 0.5 }}></i>
                      No transaction history available.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* ========== SETTINGS PANEL ========== */}
          {activePanel === 'settings' && (
            <div className="settings-grid">
              <div className="glass-card settings-card">
                <div className="settings-header">
                  <i className="ph ph-wallet"></i>
                  <h3>Wallet Information</h3>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Connected Address</span>
                  <div className="setting-value-row">
                    <code className="address-full">{address}</code>
                    <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(address); showNotification('Address copied!', 'success'); }}>
                      <i className="ph ph-copy"></i>
                    </button>
                  </div>
                </div>
                <div className="setting-item">
                  <span className="setting-label">USDC Balance (Arbitrum)</span>
                  <span className="setting-value">{fmtUsd(Number(userUsdcBalances.arb) / 1e6)}</span>
                </div>
                <div className="setting-item">
                  <span className="setting-label">USDC Balance (Base)</span>
                  <span className="setting-value">{fmtUsd(Number(userUsdcBalances.base) / 1e6)}</span>
                </div>
                <button className="btn btn-secondary btn-danger" onClick={handleLogout} style={{ marginTop: '16px' }}>
                  <i className="ph ph-sign-out"></i> Disconnect Wallet
                </button>
              </div>

              <div className="glass-card settings-card">
                <div className="settings-header">
                  <i className="ph ph-clock"></i>
                  <h3>Redemption Policy</h3>
                </div>
                <div className="info-callout">
                  <i className="ph ph-info"></i>
                  <p>To ensure sufficient liquidity for all investors, redemptions require a <strong>{formatCooldownDisplay()}</strong> waiting period after submitting a request.</p>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Current Cooldown Period</span>
                  <span className="setting-value">{formatCooldownDisplay()}</span>
                </div>
              </div>

              <div className="glass-card settings-card">
                <div className="settings-header">
                  <i className="ph ph-link"></i>
                  <h3>Quick Links</h3>
                </div>
                <a href="https://widget.mtpelerin.com/?type=web&lang=en&tab=buy&bdc=USDC&net=ARBITRUM&amt=500&cur=EUR" target="_blank" rel="noreferrer" className="quick-link">
                  <i className="ph ph-credit-card"></i>
                  <span>Buy USDC (Arbitrum)</span>
                  <i className="ph ph-arrow-square-out"></i>
                </a>
                <a href="https://widget.mtpelerin.com/?type=web&lang=en&tab=buy&bdc=USDC&net=BASE&amt=500&cur=EUR" target="_blank" rel="noreferrer" className="quick-link">
                  <i className="ph ph-credit-card"></i>
                  <span>Buy USDC (Base)</span>
                  <i className="ph ph-arrow-square-out"></i>
                </a>
                <a href="/strategies.html" className="quick-link">
                  <i className="ph ph-chart-line-up"></i>
                  <span>View Strategies</span>
                  <i className="ph ph-arrow-right"></i>
                </a>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ========== DEPOSIT MODAL ========== */}
      {depositModal.open && (
        <div className="modal-overlay" onClick={() => setDepositModal({ open: false, vault: 'arb' })}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-icon" style={{ background: ENZYME_VAULTS[depositModal.vault].color + '20', color: ENZYME_VAULTS[depositModal.vault].color }}>
                <i className="ph ph-plus"></i>
              </div>
              <div>
                <div className="modal-title">Deposit USDC</div>
                <div className="modal-subtitle">Add funds to {ENZYME_VAULTS[depositModal.vault].name}</div>
              </div>
              <button className="close-btn" onClick={() => setDepositModal({ open: false, vault: 'arb' })}>
                <i className="ph ph-x"></i>
              </button>
            </div>

            <div className="modal-body">
              <div className="input-group">
                <label className="input-label">Select Vault</label>
                <div className="select-wrapper">
                  <select
                    className="input-field"
                    value={depositModal.vault}
                    onChange={(e) => setDepositModal({ ...depositModal, vault: e.target.value })}
                  >
                    {Object.entries(ENZYME_VAULTS).map(([key, vault]) => (
                      <option key={key} value={key}>{vault.name} ({vault.network})</option>
                    ))}
                  </select>
                  <i className="ph ph-caret-down"></i>
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">Amount (USDC)</label>
                <div className="input-box">
                  <input
                    type="number"
                    placeholder="0.00"
                    value={depositAmount}
                    onChange={e => setDepositAmount(e.target.value)}
                  />
                  <span className="max-tag" onClick={() => setDepositAmount((Number(userUsdcBalances[depositModal.vault]) / 1e6).toFixed(2))}>
                    MAX
                  </span>
                </div>
                <div className="input-helper">
                  Balance: {(Number(userUsdcBalances[depositModal.vault]) / 1e6).toFixed(2)} USDC
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDepositModal({ open: false, vault: 'arb' })}>Cancel</button>
              <button className="btn btn-primary" onClick={handleDeposit} disabled={isProcessing}>
                {isProcessing ? <><i className="ph ph-spinner spinning"></i> Processing...</> : <><i className="ph ph-check"></i> Confirm Deposit</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== REDEEM MODAL ========== */}
      {redeemModal.open && (
        <div className="modal-overlay" onClick={() => setRedeemModal({ open: false, vault: 'arb' })}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-icon" style={{ background: hasPendingRedemption(redeemModal.vault) ? (isRedemptionReady(redeemModal.vault) ? '#10B98120' : '#F59E0B20') : '#6B728020', color: hasPendingRedemption(redeemModal.vault) ? (isRedemptionReady(redeemModal.vault) ? '#10B981' : '#F59E0B') : '#6B7280' }}>
                <i className={`ph ${hasPendingRedemption(redeemModal.vault) ? 'ph-clock' : 'ph-minus'}`}></i>
              </div>
              <div>
                <div className="modal-title">{hasPendingRedemption(redeemModal.vault) ? 'Pending Redemption' : 'Request Redemption'}</div>
                <div className="modal-subtitle">{hasPendingRedemption(redeemModal.vault) ? 'Your withdrawal request status' : 'Withdraw your funds from the vault'}</div>
              </div>
              <button className="close-btn" onClick={() => setRedeemModal({ open: false, vault: 'arb' })}>
                <i className="ph ph-x"></i>
              </button>
            </div>

            <div className="modal-body">
              {hasPendingRedemption(redeemModal.vault) ? (
                <>
                  {isRedemptionReady(redeemModal.vault) ? (
                    <div className="status-box success">
                      <i className="ph ph-check-circle"></i>
                      <span>Ready to withdraw!</span>
                    </div>
                  ) : (
                    <>
                      <div className="status-box warning">
                        <i className="ph ph-clock"></i>
                        <span>Withdrawal pending</span>
                      </div>
                      <div className="countdown-display">
                        <span className="countdown-label">Time remaining</span>
                        <span className="countdown-value">{formatCountdown(countdowns[redeemModal.vault])}</span>
                      </div>
                    </>
                  )}

                  <div className="details-grid">
                    <div className="detail-item">
                      <span>Shares</span>
                      <strong>{pendingRedemptions[redeemModal.vault]?.shares_amount.toFixed(6)}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Estimated Value</span>
                      <strong>{fmtUsd(pendingRedemptions[redeemModal.vault]?.estimated_usdc_value)}</strong>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="info-callout warning">
                    <i className="ph ph-clock"></i>
                    <div>
                      <strong>{formatCooldownDisplay()} waiting period</strong>
                      <p>After submitting, you'll need to wait before completing the withdrawal.</p>
                    </div>
                  </div>

                  <div className="input-group">
                    <label className="input-label">Select Vault</label>
                    <div className="select-wrapper">
                      <select
                        className="input-field"
                        value={redeemModal.vault}
                        onChange={(e) => setRedeemModal({ ...redeemModal, vault: e.target.value })}
                      >
                        {Object.entries(ENZYME_VAULTS).map(([key, vault]) => (
                          <option key={key} value={key}>{vault.name} ({vault.network})</option>
                        ))}
                      </select>
                      <i className="ph ph-caret-down"></i>
                    </div>
                  </div>

                  <div className="input-group">
                    <label className="input-label">Amount (Shares)</label>
                    <div className="input-box">
                      <input
                        type="number"
                        placeholder="0.00"
                        value={redeemAmount}
                        onChange={e => setRedeemAmount(e.target.value)}
                      />
                      <span className="max-tag" onClick={() => setRedeemAmount((Number(userVaultBalances[redeemModal.vault]) / 1e18).toFixed(6))}>
                        MAX
                      </span>
                    </div>
                    <div className="input-helper">
                      <span>Your shares: {(Number(userVaultBalances[redeemModal.vault]) / 1e18).toFixed(6)}</span>
                      {redeemAmount && (
                        <span className="estimated">≈ {fmtUsd(parseFloat(redeemAmount) * (vaultData[redeemModal.vault]?.share_price || 1))}</span>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="modal-footer">
              {hasPendingRedemption(redeemModal.vault) ? (
                <>
                  <button className="btn btn-secondary" onClick={() => cancelRedemption(redeemModal.vault)}>
                    <i className="ph ph-x"></i> Cancel Request
                  </button>
                  {isRedemptionReady(redeemModal.vault) && (
                    <button className="btn btn-primary" onClick={executeRedemption} disabled={isProcessing}>
                      {isProcessing ? <><i className="ph ph-spinner spinning"></i> Processing...</> : <><i className="ph ph-check"></i> Complete Withdrawal</>}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button className="btn btn-secondary" onClick={() => setRedeemModal({ open: false, vault: 'arb' })}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleRedemptionRequest} disabled={isProcessing}>
                    {isProcessing ? <><i className="ph ph-spinner spinning"></i> Processing...</> : <><i className="ph ph-paper-plane-tilt"></i> Submit Request</>}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
