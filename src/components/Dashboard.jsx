import { useState, useEffect, useCallback } from 'react';
import { useDisconnect, useActiveWallet } from 'thirdweb/react';
import { getContract, readContract, prepareContractCall, sendTransaction } from 'thirdweb';
import { createThirdwebClient } from 'thirdweb';
import { arbitrum, base } from 'thirdweb/chains';

const client = createThirdwebClient({ clientId: 'ef76c96ae163aba05ebd7e20d94b81fd' });

// API Endpoints
const VAULT_API_URL = 'https://ucrvaqztvfnphhoqcbpo.supabase.co/functions/v1/FIRECRAWL_DATA';
const REDEMPTION_API_URL = 'https://ucrvaqztvfnphhoqcbpo.supabase.co/functions/v1/REDEMPTION_API';

// ========== ENZYME VAULT CONFIGURATION ==========
const ENZYME_VAULTS = {
  arb: {
    name: 'DeFi Yield',
    icon: '/favicon_arbitrum.svg',
    network: 'Arbitrum',
    vaultProxy: '0x591e7194fee6f5615ea89000318e630eab92fbe1',
    denominationAsset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    chain: arbitrum,
    enzymeUrl: 'https://app.enzyme.finance/vault/0x591e7194fee6f5615ea89000318e630eab92fbe1?network=arbitrum'
  },
  base: {
    name: 'Stable Yield',
    icon: '/favicon_base.jpeg',
    network: 'Base',
    vaultProxy: null,
    denominationAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    chain: base,
    enzymeUrl: null
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
  const [activePanel, setActivePanel] = useState('overview');
  
  // Mobile Menu State
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [vaultData, setVaultData] = useState({ arb: null, base: null });
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

  // Format helpers
  const fmtUsd = (v) => {
    if (v == null || isNaN(Number(v))) return '$—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v));
  };

  const fmtPercent = (v) => {
    if (v == null) return '—%';
    const n = Number(v);
    if (isNaN(n)) return '—%';
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  };

  const formatCountdown = (ms) => {
    if (ms <= 0) return 'Ready!';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m ${seconds}s`;
  };

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';

  const showNotification = (message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // API Calls & Logic (Keep existing logic)
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

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [arbRes, baseRes] = await Promise.all([
          fetch(`${VAULT_API_URL}?action=get&network=arbitrum`),
          fetch(`${VAULT_API_URL}?action=get&network=base`),
        ]);
        const arbData = await arbRes.json();
        const baseData = await baseRes.json();
        setVaultData({ arb: arbData, base: baseData });
      } catch (err) {
        console.error('Failed to fetch vault data:', err);
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  useEffect(() => {
    async function fetchUserBalances() {
      if (!address) return;
      if (ENZYME_VAULTS.arb.vaultProxy) {
        try {
          const vaultContract = getContract({ client, chain: arbitrum, address: ENZYME_VAULTS.arb.vaultProxy, abi: VAULT_ABI });
          const shareBalance = await readContract({ contract: vaultContract, method: 'balanceOf', params: [address] });
          const comptroller = await readContract({ contract: vaultContract, method: 'getAccessor', params: [] });
          const usdcContract = getContract({ client, chain: arbitrum, address: ENZYME_VAULTS.arb.denominationAsset, abi: ERC20_ABI });
          const usdcBalance = await readContract({ contract: usdcContract, method: 'balanceOf', params: [address] });

          setUserVaultBalances(prev => ({ ...prev, arb: shareBalance }));
          setUserUsdcBalances(prev => ({ ...prev, arb: usdcBalance }));
          setComptrollerAddresses(prev => ({ ...prev, arb: comptroller }));
        } catch (err) {
          console.error('Failed to fetch Arbitrum balances:', err);
        }
      }
    }
    fetchUserBalances();
  }, [address]);

  useEffect(() => { fetchPendingRedemptions(); }, [fetchPendingRedemptions]);

  useEffect(() => {
    const interval = setInterval(() => {
      const newCountdowns = { arb: null, base: null };
      for (const vault of ['arb', 'base']) {
        const pending = pendingRedemptions[vault];
        if (pending) {
          const unlockTime = new Date(pending.unlock_at).getTime();
          const remaining = unlockTime - Date.now();
          newCountdowns[vault] = remaining > 0 ? remaining : 0;
        }
      }
      setCountdowns(newCountdowns);
    }, 1000);
    return () => clearInterval(interval);
  }, [pendingRedemptions]);

  const getUserVaultValue = (vaultKey) => {
    const shares = Number(userVaultBalances[vaultKey]) / 1e18;
    const sharePrice = vaultData[vaultKey]?.share_price || 1;
    return shares * sharePrice;
  };

  const totalBalance = getUserVaultValue('arb') + getUserVaultValue('base');

  const handleDeposit = async () => {
    const vaultKey = depositModal.vault;
    const vault = ENZYME_VAULTS[vaultKey];
    
    if (!vault?.vaultProxy) {
      showNotification('Vault not available', 'error');
      return;
    }
    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      showNotification('Invalid amount', 'error');
      return;
    }

    setIsProcessing(true);
    try {
      const account = await wallet.getAccount();
      const amount = BigInt(Math.floor(parseFloat(depositAmount) * 1e6));

      if (userUsdcBalances[vaultKey] < amount) {
        showNotification('Insufficient USDC', 'error');
        setIsProcessing(false);
        return;
      }

      const comptrollerAddr = comptrollerAddresses[vaultKey];
      const usdcContract = getContract({ client, chain: vault.chain, address: vault.denominationAsset, abi: ERC20_ABI });
      const approveTx = prepareContractCall({ contract: usdcContract, method: 'approve', params: [comptrollerAddr, amount] });
      await sendTransaction({ transaction: approveTx, account });

      const comptrollerContract = getContract({ client, chain: vault.chain, address: comptrollerAddr, abi: COMPTROLLER_ABI });
      const depositTx = prepareContractCall({ contract: comptrollerContract, method: 'buyShares', params: [amount, 1n] });
      await sendTransaction({ transaction: depositTx, account });

      showNotification(`Deposited ${depositAmount} USDC`, 'success');
      setDepositModal({ open: false, vault: 'arb' });
      setDepositAmount('');
      window.location.reload();
    } catch (err) {
      showNotification(err.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRedemptionRequest = async () => {
    const vaultKey = redeemModal.vault;
    const vault = ENZYME_VAULTS[vaultKey];
    
    if (!vault?.vaultProxy) return;
    if (!redeemAmount) return;

    const sharesAmount = parseFloat(redeemAmount);
    const userShares = Number(userVaultBalances[vaultKey]) / 1e18;
    
    if (sharesAmount > userShares) {
      showNotification('Insufficient shares', 'error');
      return;
    }

    setIsProcessing(true);
    try {
      const sharePrice = vaultData[vaultKey]?.share_price || 1;
      const estimatedUsdc = sharesAmount * sharePrice;
      const request = await createRedemptionRequest(vaultKey, sharesAmount, estimatedUsdc);
      setPendingRedemptions(prev => ({ ...prev, [vaultKey]: request }));
      showNotification('Redemption requested', 'success');
      setRedeemAmount('');
    } catch (err) {
      showNotification(err.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const executeRedemption = async () => {
    const vaultKey = redeemModal.vault;
    const vault = ENZYME_VAULTS[vaultKey];
    const pending = pendingRedemptions[vaultKey];
    
    if (!pending || countdowns[vaultKey] > 0) return;

    setIsProcessing(true);
    try {
      const account = await wallet.getAccount();
      const sharesAmount = BigInt(Math.floor(pending.shares_amount * 1e18));
      const comptrollerContract = getContract({ client, chain: vault.chain, address: comptrollerAddresses[vaultKey], abi: COMPTROLLER_ABI });
      
      const redeemTx = prepareContractCall({
        contract: comptrollerContract,
        method: 'redeemSharesForSpecificAssets',
        params: [address, sharesAmount, [vault.denominationAsset], [10000n]]
      });
      const result = await sendTransaction({ transaction: redeemTx, account });
      await updateRedemptionStatus(pending.id, 'completed', result?.transactionHash);
      
      showNotification('Redemption confirmed', 'success');
      setRedeemModal({ open: false, vault: 'arb' });
      setPendingRedemptions(prev => ({ ...prev, [vaultKey]: null }));
      window.location.reload();
    } catch (err) {
      showNotification(err.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLogout = async () => {
    if (wallet) await disconnect(wallet);
  };

  const navItems = [
    { id: 'overview', icon: 'ph-squares-four', label: 'Overview' },
    { id: 'vaults', icon: 'ph-bank', label: 'Vaults' },
    { id: 'transactions', icon: 'ph-list-dashes', label: 'History' },
  ];

  return (
    <div className="dashboard-layout">
      {/* Mobile Menu Backdrop */}
      {isMobileMenuOpen && (
        <div className="menu-backdrop" onClick={() => setIsMobileMenuOpen(false)}></div>
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <a href="/" className="logo-container">
            <img src="/logo_g12.svg" alt="G12" />
            <span>G12 LABS</span>
          </a>
        </div>

        <div className="nav-content">
          <div className="nav-group-label">Menu</div>
          {navItems.map((item) => (
            <div
              key={item.id}
              className={`nav-item ${activePanel === item.id ? 'active' : ''}`}
              onClick={() => {
                setActivePanel(item.id);
                setIsMobileMenuOpen(false);
              }}
            >
              <i className={`ph ${item.icon}`}></i>
              <span>{item.label}</span>
            </div>
          ))}

          <div className="nav-group-label" style={{ marginTop: '24px' }}>Links</div>
          <a href="/strategies.html" className="nav-item">
            <i className="ph ph-chart-line-up"></i>
            <span>Strategies</span>
          </a>
          <a href="/docs.html" className="nav-item">
            <i className="ph ph-book"></i>
            <span>Documentation</span>
          </a>
        </div>

        <div className="sidebar-footer">
          <div className="user-badge">
            <div className="user-avatar">{address ? address.slice(2,4).toUpperCase() : '0x'}</div>
            <div className="user-details">
              <span className="user-addr mono">{shortAddress}</span>
              <span className="user-status"><div className="status-dot"></div> Connected</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button className="mobile-menu-btn" onClick={() => setIsMobileMenuOpen(true)}>
              <i className="ph ph-list"></i>
            </button>
            <h1 className="page-title">
              {navItems.find((n) => n.id === activePanel)?.label || 'Overview'}
            </h1>
          </div>
          <div className="topbar-actions">
            <button className="action-btn" onClick={() => window.location.reload()} title="Refresh">
              <i className="ph ph-arrows-clockwise"></i>
            </button>
            <button className="action-btn" onClick={handleLogout} title="Disconnect">
              <i className="ph ph-sign-out"></i>
            </button>
          </div>
        </header>

        <div className="content-wrapper">
          {/* OVERVIEW PANEL */}
          {activePanel === 'overview' && (
            <>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-label"><i className="ph ph-wallet"></i> Total Balance</div>
                  <div className="stat-value mono">{fmtUsd(totalBalance)}</div>
                  <div className="stat-sub">Across all vaults</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label"><i className="ph ph-trend-up"></i> Net APY</div>
                  <div className="stat-value mono">
                    {vaultData.arb ? fmtPercent(vaultData.arb.monthly_return * 12) : '—%'}
                  </div>
                  <div className="stat-sub positive">Weighted Avg</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label"><i className="ph ph-coins"></i> Wallet USDC</div>
                  <div className="stat-value mono">{fmtUsd(Number(userUsdcBalances.arb) / 1e6)}</div>
                  <div className="stat-sub">Available</div>
                </div>
              </div>

              <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px' }}>Active Positions</h2>
              
              <div className="vault-grid">
                {Object.keys(ENZYME_VAULTS).map((key) => {
                  const vault = ENZYME_VAULTS[key];
                  const data = vaultData[key];
                  const balance = userVaultBalances[key];
                  const hasPending = !!pendingRedemptions[key];
                  
                  return (
                    <div className="vault-card" key={key}>
                      <div className="vault-header">
                        <div className="vault-identity">
                          <img src={vault.icon} className="vault-icon" alt={key} />
                          <div className="vault-title">
                            <h3>{vault.name}</h3>
                            <div className="vault-badge">{vault.network}</div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="vault-body">
                        <div className="vault-metrics">
                          <div className="metric-item">
                            <label>Your Balance</label>
                            <span className="mono">{fmtUsd(getUserVaultValue(key))}</span>
                          </div>
                          <div className="metric-item">
                            <label>Share Price</label>
                            <span className="mono">
                              {data ? `$${Number(data.share_price).toFixed(4)}` : '$—'}
                            </span>
                          </div>
                          <div className="metric-item">
                            <label>APY</label>
                            <span className="mono" style={{ color: 'var(--success)' }}>
                              {data ? fmtPercent(data.monthly_return * 12) : '—%'}
                            </span>
                          </div>
                        </div>

                        <div className="vault-actions">
                          <button 
                            className="btn btn-primary" 
                            style={{ flex: 1 }}
                            disabled={!vault.vaultProxy}
                            onClick={() => setDepositModal({ open: true, vault: key })}
                          >
                            <i className="ph ph-arrow-down"></i> Deposit
                          </button>
                          <button 
                            className="btn btn-secondary" 
                            style={{ flex: 1 }}
                            disabled={!vault.vaultProxy}
                            onClick={() => setRedeemModal({ open: true, vault: key })}
                          >
                            {hasPending ? <i className="ph ph-clock"></i> : <i className="ph ph-arrow-up"></i>}
                            {hasPending ? 'Pending' : 'Redeem'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* VAULTS PANEL */}
          {activePanel === 'vaults' && (
             <div className="vault-grid">
               {/* Same loop as overview, simplified for demo */}
               {Object.keys(ENZYME_VAULTS).map((key) => {
                  const vault = ENZYME_VAULTS[key];
                  return (
                    <div className="vault-card" key={key}>
                      <div className="vault-header">
                        <div className="vault-identity">
                          <img src={vault.icon} className="vault-icon" />
                          <div className="vault-title"><h3>{vault.name}</h3></div>
                        </div>
                        <div className="vault-badge">{vault.network}</div>
                      </div>
                      <div className="vault-body">
                         <p style={{ color: '#888', fontSize: '14px', marginBottom: '20px' }}>
                           Automated strategy on {vault.network}. Capital preservation focused.
                         </p>
                         <button 
                            className="btn btn-primary" 
                            style={{ width: '100%' }}
                            onClick={() => setDepositModal({ open: true, vault: key })}
                            disabled={!vault.vaultProxy}
                          >
                            Deposit USDC
                          </button>
                      </div>
                    </div>
                  )
               })}
             </div>
          )}

          {/* HISTORY PANEL */}
          {activePanel === 'transactions' && (
            <div className="stat-card" style={{ textAlign: 'center', padding: '60px' }}>
              <i className="ph ph-scroll" style={{ fontSize: '48px', color: '#333', marginBottom: '20px' }}></i>
              <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>No transactions yet</h3>
              <p style={{ color: '#888' }}>Your deposit and withdrawal history will appear here.</p>
            </div>
          )}
        </div>
      </main>

      {/* MODALS */}
      {depositModal.open && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <div className="modal-title"><i className="ph ph-arrow-down"></i> Deposit Funds</div>
              <button className="close-btn" onClick={() => setDepositModal({ open: false, vault: 'arb' })}>×</button>
            </div>
            <div className="modal-body">
              <div className="modal-info-box">
                Network: <strong>{ENZYME_VAULTS[depositModal.vault].network}</strong><br/>
                Asset: <strong>USDC</strong>
              </div>
              
              <div className="input-container">
                <input 
                  type="number" 
                  className="amount-input mono" 
                  placeholder="0.00" 
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                />
                <button className="max-btn" onClick={() => setDepositAmount((Number(userUsdcBalances[depositModal.vault]) / 1e6).toFixed(2))}>MAX</button>
              </div>
              
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleDeposit} disabled={isProcessing}>
                {isProcessing ? 'Processing...' : 'Confirm Deposit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NOTIFICATIONS */}
      {notification && (
        <div className="stat-card" style={{ 
          position: 'fixed', bottom: '20px', right: '20px', 
          zIndex: 9999, padding: '16px', display: 'flex', alignItems: 'center', gap: '12px',
          borderLeft: `4px solid ${notification.type === 'error' ? '#EF4444' : '#10B981'}`
        }}>
          <span>{notification.message}</span>
        </div>
      )}

    </div>
  );
}

export default Dashboard;