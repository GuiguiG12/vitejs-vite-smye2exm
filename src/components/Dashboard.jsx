import { useState, useEffect, useCallback, useRef } from 'react';
import { useDisconnect, useActiveWallet } from 'thirdweb/react';
import { getContract, readContract, prepareContractCall, sendTransaction } from 'thirdweb';
import { createThirdwebClient } from 'thirdweb';
import { arbitrum, base } from 'thirdweb/chains';

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
    denominationAsset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
    chain: arbitrum,
    color: '#E85A04',
    enzymeUrl: 'https://app.enzyme.finance/vault/0xc9e50e08739a4aec211f2e8e95f1ab45b923cc20?network=arbitrum',
    icon: '📈'
  },
  base: {
    name: 'Stable Yield',
    network: 'Base',
    vaultProxy: '0xbfa811e1f065c9b66b02d8ae408d4d9b9be70a22',
    denominationAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
    chain: base,
    color: '#0052FF',
    enzymeUrl: 'https://app.enzyme.finance/vault/0xbfa811e1f065c9b66b02d8ae408d4d9b9be70a22?network=base',
    icon: '🛡️'
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
  const chartRefs = useRef({ arb: null, base: null });
  const chartInstances = useRef({ arb: null, base: null });
  
  const [activePanel, setActivePanel] = useState('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [vaultData, setVaultData] = useState({ arb: null, base: null });
  const [historyData, setHistoryData] = useState({ arb: [], base: [] });
  const [loading, setLoading] = useState(true);

  // User balances from blockchain
  const [userVaultBalances, setUserVaultBalances] = useState({ arb: 0n, base: 0n });
  const [userUsdcBalances, setUserUsdcBalances] = useState({ arb: 0n, base: 0n });
  const [comptrollerAddresses, setComptrollerAddresses] = useState({ arb: null, base: null });

  // Modal state
  const [depositModal, setDepositModal] = useState({ open: false, vault: 'arb' });
  const [redeemModal, setRedeemModal] = useState({ open: false, vault: 'arb' });
  const [depositAmount, setDepositAmount] = useState('');
  const [redeemAmount, setRedeemAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [notification, setNotification] = useState(null);

  // Redemption cooldown state
  const [pendingRedemptions, setPendingRedemptions] = useState({ arb: null, base: null });
  const [countdowns, setCountdowns] = useState({ arb: null, base: null });
  const [cooldownSeconds, setCooldownSeconds] = useState(120);

  // Chart settings
  const [chartMetric, setChartMetric] = useState({ arb: 'share_price', base: 'share_price' });
  const [chartRange, setChartRange] = useState({ arb: '1W', base: '1W' });

  // Format helpers
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

  // ========== CHART FUNCTIONS ==========
  const toPointArray = (rows, field) => {
    const pts = [];
    for (const r of rows || []) {
      const t = new Date(r.scraped_at).getTime();
      const v = r[field];
      if (!t || v == null || isNaN(Number(v))) continue;
      pts.push({ t, v: Number(v) });
    }
    pts.sort((a, b) => a.t - b.t);
    return pts;
  };

  const filterByRange = (points, range) => {
    if (range === 'ALL') return points;
    const now = Date.now();
    const ms = range === '1W' ? 604800000 : range === '1M' ? 2592000000 : 604800000;
    return points.filter(p => p.t >= now - ms);
  };

  const renderChart = useCallback((vaultKey) => {
    if (!chartRefs.current[vaultKey] || !window.echarts) return;
    
    const vault = ENZYME_VAULTS[vaultKey];
    const metric = chartMetric[vaultKey];
    const range = chartRange[vaultKey];
    const rawPts = toPointArray(historyData[vaultKey], metric);
    const pts = filterByRange(rawPts, range);
    
    if (!chartInstances.current[vaultKey]) {
      chartInstances.current[vaultKey] = window.echarts.init(chartRefs.current[vaultKey]);
    }
    
    const chart = chartInstances.current[vaultKey];
    const x = pts.map(p => new Date(p.t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }));
    const y = pts.map(p => p.v);
    const isShare = metric === 'share_price';
    
    const option = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (params) => {
          if (!params.length) return '';
          const idx = params[0].dataIndex;
          const p = pts[idx];
          const vtxt = isShare ? fmtSharePrice(p.v) : fmtUsd(p.v);
          const date = new Date(p.t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
          return `<div style="font-weight:600">${date}</div><div style="color:${vault.color};margin-top:4px">${vtxt}</div>`;
        }
      },
      grid: { left: 0, right: 0, top: 10, bottom: 0, containLabel: false },
      xAxis: { type: 'category', show: false, data: x, boundaryGap: false },
      yAxis: { type: 'value', show: false, scale: true },
      series: [{
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: y,
        lineStyle: { color: vault.color, width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: vault.color + '30' },
              { offset: 1, color: vault.color + '00' }
            ]
          }
        }
      }]
    };
    
    if (pts.length < 2) {
      option.graphic = [{
        type: 'text',
        left: 'center',
        top: 'middle',
        style: { text: 'Awaiting data...', fontSize: 13, fill: '#6B7280' }
      }];
    }
    
    chart.setOption(option, true);
    chart.resize();
  }, [chartMetric, chartRange, historyData]);

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
  useEffect(() => {
    async function fetchData() {
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
      } catch (err) {
        console.error('Failed to fetch vault data:', err);
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  // Fetch user balances from blockchain
  useEffect(() => {
    async function fetchUserBalances() {
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
    }
    fetchUserBalances();
  }, [address]);

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

  // Render charts when data changes
  useEffect(() => {
    if (!loading && historyData.arb.length) renderChart('arb');
    if (!loading && historyData.base.length) renderChart('base');
  }, [loading, historyData, renderChart]);

  // Handle window resize for charts
  useEffect(() => {
    const handleResize = () => {
      Object.values(chartInstances.current).forEach(chart => chart?.resize());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Calculate values
  const getUserVaultValue = (vaultKey) => {
    const shares = Number(userVaultBalances[vaultKey]) / 1e18;
    const sharePrice = vaultData[vaultKey]?.share_price || 1;
    return shares * sharePrice;
  };

  const totalBalance = getUserVaultValue('arb') + getUserVaultValue('base');
  const totalAUM = (Number(vaultData.arb?.aum) || 0) + (Number(vaultData.base?.aum) || 0);

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

      const usdcContract = getContract({ client, chain: vault.chain, address: vault.denominationAsset, abi: ERC20_ABI });
      const approveTx = prepareContractCall({ contract: usdcContract, method: 'approve', params: [comptrollerAddr, amount] });
      await sendTransaction({ transaction: approveTx, account });

      const comptrollerContract = getContract({ client, chain: vault.chain, address: comptrollerAddr, abi: COMPTROLLER_ABI });
      const depositTx = prepareContractCall({ contract: comptrollerContract, method: 'buyShares', params: [amount, 1n] });
      await sendTransaction({ transaction: depositTx, account });

      showNotification(`Successfully deposited ${depositAmount} USDC!`, 'success');
      setDepositModal({ open: false, vault: 'arb' });
      setDepositAmount('');
      window.location.reload();
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
      window.location.reload();
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

  const navItems = [
    { id: 'overview', icon: 'ph-chart-pie', label: 'Overview' },
    { id: 'vaults', icon: 'ph-vault', label: 'Vaults' },
    { id: 'settings', icon: 'ph-gear', label: 'Settings' },
  ];

  // ========== RENDER ==========
  return (
    <div className="dashboard">
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

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <a href="/" className="sidebar-brand">
            <img src="/logo_g12.svg" alt="G12 Labs" />
            <span>G12 LABS</span>
          </a>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activePanel === item.id ? 'active' : ''}`}
              onClick={() => { setActivePanel(item.id); setMobileMenuOpen(false); }}
            >
              <i className={`ph ${item.icon}`}></i>
              <span>{item.label}</span>
            </button>
          ))}
          
          <div className="nav-divider"></div>
          
          <a href="/strategies.html" className="nav-item">
            <i className="ph ph-chart-line-up"></i>
            <span>Strategies</span>
          </a>
          <a href="/docs.html" className="nav-item">
            <i className="ph ph-book-open"></i>
            <span>Documentation</span>
          </a>
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">
              <i className="ph ph-wallet"></i>
            </div>
            <div className="user-info">
              <span className="user-address">{shortAddress}</span>
              <span className="user-status">
                <span className="status-dot"></span>
                Connected
              </span>
            </div>
            <button className="user-logout" onClick={handleLogout} title="Disconnect">
              <i className="ph ph-sign-out"></i>
            </button>
          </div>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {mobileMenuOpen && <div className="sidebar-overlay" onClick={() => setMobileMenuOpen(false)}></div>}

      {/* Notification */}
      {notification && (
        <div className={`notification ${notification.type}`}>
          <i className={`ph ${notification.type === 'success' ? 'ph-check-circle' : notification.type === 'error' ? 'ph-x-circle' : 'ph-info'}`}></i>
          <span>{notification.message}</span>
        </div>
      )}

      {/* Main Content */}
      <main className="main-content">
        {/* Overview Panel */}
        {activePanel === 'overview' && (
          <div className="panel">
            <div className="panel-header">
              <div>
                <h1 className="panel-title">Portfolio Overview</h1>
                <p className="panel-subtitle">Track your investments across all vaults</p>
              </div>
              <div className="header-actions">
                <button className="btn btn-primary" onClick={() => setDepositModal({ open: true, vault: 'arb' })}>
                  <i className="ph ph-plus"></i>
                  <span>Deposit</span>
                </button>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="stats-grid">
              <div className="stat-card featured">
                <div className="stat-icon">
                  <i className="ph ph-wallet"></i>
                </div>
                <div className="stat-content">
                  <span className="stat-label">Your Balance</span>
                  <span className="stat-value">{fmtUsd(totalBalance)}</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon blue">
                  <i className="ph ph-bank"></i>
                </div>
                <div className="stat-content">
                  <span className="stat-label">Total AUM</span>
                  <span className="stat-value">{fmtUsd(totalAUM)}</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon green">
                  <i className="ph ph-trend-up"></i>
                </div>
                <div className="stat-content">
                  <span className="stat-label">Arbitrum APY</span>
                  <span className="stat-value positive">{vaultData.arb ? fmtPercent(vaultData.arb.monthly_return * 12) : '—'}</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon purple">
                  <i className="ph ph-shield-check"></i>
                </div>
                <div className="stat-content">
                  <span className="stat-label">Base APY</span>
                  <span className="stat-value positive">{vaultData.base ? fmtPercent(vaultData.base.monthly_return * 12) : '—'}</span>
                </div>
              </div>
            </div>

            {/* Vault Summary Cards */}
            <div className="vault-summary-grid">
              {Object.entries(ENZYME_VAULTS).map(([key, vault]) => (
                <div key={key} className="vault-summary-card">
                  <div className="vault-summary-header">
                    <div className="vault-info">
                      <div className="vault-icon" style={{ background: vault.color + '20', color: vault.color }}>
                        {vault.icon}
                      </div>
                      <div>
                        <h3 className="vault-name">{vault.name}</h3>
                        <span className="vault-network">{vault.network}</span>
                      </div>
                    </div>
                    <div className="vault-apy">
                      <span className="apy-label">Net APY</span>
                      <span className="apy-value" style={{ color: vault.color }}>
                        {vaultData[key] ? fmtPercent(vaultData[key].monthly_return * 12) : '—'}
                      </span>
                    </div>
                  </div>
                  
                  <div className="vault-chart" ref={el => chartRefs.current[key] = el}></div>
                  
                  <div className="chart-controls">
                    <div className="metric-btns">
                      <button 
                        className={`chart-btn ${chartMetric[key] === 'share_price' ? 'active' : ''}`}
                        onClick={() => { setChartMetric(p => ({ ...p, [key]: 'share_price' })); setTimeout(() => renderChart(key), 10); }}
                      >
                        Share Price
                      </button>
                      <button 
                        className={`chart-btn ${chartMetric[key] === 'aum' ? 'active' : ''}`}
                        onClick={() => { setChartMetric(p => ({ ...p, [key]: 'aum' })); setTimeout(() => renderChart(key), 10); }}
                      >
                        AUM
                      </button>
                    </div>
                    <div className="range-btns">
                      {['1W', '1M', 'ALL'].map(r => (
                        <button 
                          key={r}
                          className={`chart-btn ${chartRange[key] === r ? 'active' : ''}`}
                          onClick={() => { setChartRange(p => ({ ...p, [key]: r })); setTimeout(() => renderChart(key), 10); }}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="vault-stats-row">
                    <div className="vault-stat">
                      <span className="stat-label">Your Balance</span>
                      <span className="stat-value">{fmtUsd(getUserVaultValue(key))}</span>
                    </div>
                    <div className="vault-stat">
                      <span className="stat-label">Share Price</span>
                      <span className="stat-value">{fmtSharePrice(vaultData[key]?.share_price)}</span>
                    </div>
                    <div className="vault-stat">
                      <span className="stat-label">Total AUM</span>
                      <span className="stat-value">{fmtUsd(vaultData[key]?.aum)}</span>
                    </div>
                  </div>

                  <div className="vault-actions">
                    <button className="btn btn-primary" onClick={() => setDepositModal({ open: true, vault: key })}>
                      <i className="ph ph-plus"></i> Deposit
                    </button>
                    <button 
                      className={`btn ${hasPendingRedemption(key) ? 'btn-warning' : 'btn-secondary'}`}
                      onClick={() => setRedeemModal({ open: true, vault: key })}
                    >
                      {hasPendingRedemption(key) 
                        ? (isRedemptionReady(key) ? <><i className="ph ph-check"></i> Withdraw</> : <><i className="ph ph-clock"></i> {formatCountdown(countdowns[key])}</>)
                        : <><i className="ph ph-minus"></i> Redeem</>
                      }
                    </button>
                    <a href={vault.enzymeUrl} target="_blank" rel="noreferrer" className="btn btn-ghost">
                      <i className="ph ph-arrow-square-out"></i>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Vaults Panel */}
        {activePanel === 'vaults' && (
          <div className="panel">
            <div className="panel-header">
              <div>
                <h1 className="panel-title">Vault Details</h1>
                <p className="panel-subtitle">Detailed information about each strategy</p>
              </div>
            </div>

            <div className="vaults-detailed-grid">
              {Object.entries(ENZYME_VAULTS).map(([key, vault]) => (
                <div key={key} className="vault-detailed-card">
                  <div className="vault-detailed-header" style={{ borderColor: vault.color }}>
                    <div className="vault-badge" style={{ background: vault.color }}>{vault.icon}</div>
                    <div className="vault-title-block">
                      <h2>{vault.name}</h2>
                      <span className="network-badge" style={{ background: vault.color + '20', color: vault.color }}>
                        {vault.network}
                      </span>
                    </div>
                    <div className="vault-apy-block">
                      <span className="apy-value-lg" style={{ color: vault.color }}>
                        {vaultData[key] ? fmtPercent(vaultData[key].monthly_return * 12) : '—'}
                      </span>
                      <span className="apy-label">Net APY</span>
                    </div>
                  </div>

                  <div className="vault-metrics">
                    <div className="metric">
                      <i className="ph ph-wallet"></i>
                      <div>
                        <span className="metric-label">Your Position</span>
                        <span className="metric-value">{fmtUsd(getUserVaultValue(key))}</span>
                      </div>
                    </div>
                    <div className="metric">
                      <i className="ph ph-coins"></i>
                      <div>
                        <span className="metric-label">Your Shares</span>
                        <span className="metric-value mono">{(Number(userVaultBalances[key]) / 1e18).toFixed(6)}</span>
                      </div>
                    </div>
                    <div className="metric">
                      <i className="ph ph-chart-line"></i>
                      <div>
                        <span className="metric-label">Share Price</span>
                        <span className="metric-value">{fmtSharePrice(vaultData[key]?.share_price)}</span>
                      </div>
                    </div>
                    <div className="metric">
                      <i className="ph ph-bank"></i>
                      <div>
                        <span className="metric-label">Total AUM</span>
                        <span className="metric-value">{fmtUsd(vaultData[key]?.aum)}</span>
                      </div>
                    </div>
                    <div className="metric">
                      <i className="ph ph-users"></i>
                      <div>
                        <span className="metric-label">Depositors</span>
                        <span className="metric-value">{vaultData[key]?.depositors ?? '—'}</span>
                      </div>
                    </div>
                    <div className="metric">
                      <i className="ph ph-calendar"></i>
                      <div>
                        <span className="metric-label">Monthly Return</span>
                        <span className="metric-value positive">{vaultData[key] ? fmtPercent(vaultData[key].monthly_return) : '—'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="vault-detailed-actions">
                    <button className="btn btn-primary btn-lg" onClick={() => setDepositModal({ open: true, vault: key })}>
                      <i className="ph ph-plus"></i> Deposit USDC
                    </button>
                    <button 
                      className={`btn btn-lg ${hasPendingRedemption(key) ? 'btn-warning' : 'btn-secondary'}`}
                      onClick={() => setRedeemModal({ open: true, vault: key })}
                    >
                      {hasPendingRedemption(key) 
                        ? (isRedemptionReady(key) ? <><i className="ph ph-check"></i> Complete Withdrawal</> : <><i className="ph ph-clock"></i> {formatCountdown(countdowns[key])}</>)
                        : <><i className="ph ph-minus"></i> Request Redemption</>
                      }
                    </button>
                  </div>

                  <div className="vault-footer">
                    <a href={vault.enzymeUrl} target="_blank" rel="noreferrer" className="vault-link">
                      <i className="ph ph-arrow-square-out"></i> View on Enzyme Finance
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Settings Panel */}
        {activePanel === 'settings' && (
          <div className="panel">
            <div className="panel-header">
              <div>
                <h1 className="panel-title">Settings</h1>
                <p className="panel-subtitle">Manage your account and preferences</p>
              </div>
            </div>

            <div className="settings-grid">
              <div className="settings-card">
                <div className="settings-card-header">
                  <i className="ph ph-wallet"></i>
                  <h3>Wallet</h3>
                </div>
                <div className="settings-content">
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
                </div>
                <div className="settings-card-footer">
                  <button className="btn btn-secondary btn-danger" onClick={handleLogout}>
                    <i className="ph ph-sign-out"></i> Disconnect Wallet
                  </button>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-card-header">
                  <i className="ph ph-clock"></i>
                  <h3>Redemption Policy</h3>
                </div>
                <div className="settings-content">
                  <div className="info-box">
                    <i className="ph ph-info"></i>
                    <p>To ensure sufficient liquidity for all investors, redemptions require a <strong>{formatCooldownDisplay()}</strong> waiting period after submitting a request.</p>
                  </div>
                  <div className="setting-item">
                    <span className="setting-label">Current Cooldown</span>
                    <span className="setting-value">{formatCooldownDisplay()}</span>
                  </div>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-card-header">
                  <i className="ph ph-link"></i>
                  <h3>Quick Links</h3>
                </div>
                <div className="settings-content">
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
                  <a href="/docs.html" className="quick-link">
                    <i className="ph ph-book-open"></i>
                    <span>Documentation</span>
                    <i className="ph ph-arrow-right"></i>
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Deposit Modal */}
      {depositModal.open && (
        <div className="modal-overlay" onClick={() => setDepositModal({ open: false, vault: 'arb' })}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setDepositModal({ open: false, vault: 'arb' })}>
              <i className="ph ph-x"></i>
            </button>
            
            <div className="modal-header">
              <div className="modal-icon" style={{ background: ENZYME_VAULTS[depositModal.vault].color + '20', color: ENZYME_VAULTS[depositModal.vault].color }}>
                <i className="ph ph-plus"></i>
              </div>
              <div>
                <h2 className="modal-title">Deposit Funds</h2>
                <p className="modal-subtitle">Add USDC to start earning yield</p>
              </div>
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
                <div className="input-wrapper">
                  <input 
                    type="number" 
                    className="input-field" 
                    placeholder="0.00" 
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                  />
                  <button 
                    className="max-btn"
                    onClick={() => setDepositAmount((Number(userUsdcBalances[depositModal.vault]) / 1e6).toFixed(2))}
                  >
                    MAX
                  </button>
                </div>
                <div className="input-helper">
                  <span>Balance: {(Number(userUsdcBalances[depositModal.vault]) / 1e6).toFixed(2)} USDC</span>
                </div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDepositModal({ open: false, vault: 'arb' })}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleDeposit} disabled={isProcessing}>
                {isProcessing ? <><i className="ph ph-spinner"></i> Processing...</> : <><i className="ph ph-check"></i> Confirm Deposit</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Redeem Modal */}
      {redeemModal.open && (
        <div className="modal-overlay" onClick={() => setRedeemModal({ open: false, vault: 'arb' })}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setRedeemModal({ open: false, vault: 'arb' })}>
              <i className="ph ph-x"></i>
            </button>
            
            <div className="modal-header">
              <div className="modal-icon" style={{ background: hasPendingRedemption(redeemModal.vault) ? (isRedemptionReady(redeemModal.vault) ? '#10B98120' : '#F59E0B20') : '#6B728020', color: hasPendingRedemption(redeemModal.vault) ? (isRedemptionReady(redeemModal.vault) ? '#10B981' : '#F59E0B') : '#6B7280' }}>
                <i className={`ph ${hasPendingRedemption(redeemModal.vault) ? 'ph-clock' : 'ph-minus'}`}></i>
              </div>
              <div>
                <h2 className="modal-title">{hasPendingRedemption(redeemModal.vault) ? 'Pending Redemption' : 'Request Redemption'}</h2>
                <p className="modal-subtitle">{hasPendingRedemption(redeemModal.vault) ? 'Your withdrawal request status' : 'Withdraw your funds from the vault'}</p>
              </div>
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
                      <div className="countdown-box">
                        <span className="countdown-label">Time remaining</span>
                        <span className="countdown-value">{formatCountdown(countdowns[redeemModal.vault])}</span>
                      </div>
                    </>
                  )}
                  
                  <div className="details-box">
                    <div className="detail-row">
                      <span>Shares</span>
                      <strong>{pendingRedemptions[redeemModal.vault]?.shares_amount.toFixed(6)}</strong>
                    </div>
                    <div className="detail-row">
                      <span>Estimated Value</span>
                      <strong>{fmtUsd(pendingRedemptions[redeemModal.vault]?.estimated_usdc_value)}</strong>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="info-box warning">
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
                    <div className="input-wrapper">
                      <input 
                        type="number" 
                        className="input-field" 
                        placeholder="0.00" 
                        value={redeemAmount}
                        onChange={(e) => setRedeemAmount(e.target.value)}
                      />
                      <button 
                        className="max-btn"
                        onClick={() => setRedeemAmount((Number(userVaultBalances[redeemModal.vault]) / 1e18).toFixed(6))}
                      >
                        MAX
                      </button>
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
                    Cancel Request
                  </button>
                  {isRedemptionReady(redeemModal.vault) && (
                    <button className="btn btn-primary" onClick={executeRedemption} disabled={isProcessing}>
                      {isProcessing ? <><i className="ph ph-spinner"></i> Processing...</> : <><i className="ph ph-check"></i> Complete Withdrawal</>}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button className="btn btn-secondary" onClick={() => setRedeemModal({ open: false, vault: 'arb' })}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" onClick={handleRedemptionRequest} disabled={isProcessing}>
                    {isProcessing ? <><i className="ph ph-spinner"></i> Processing...</> : <><i className="ph ph-paper-plane-tilt"></i> Submit Request</>}
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