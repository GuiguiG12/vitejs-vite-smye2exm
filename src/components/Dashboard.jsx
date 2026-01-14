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
    vaultProxy: '0x591e7194fee6f5615ea89000318e630eab92fbe1',
    denominationAsset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    chain: arbitrum,
    enzymeUrl: 'https://app.enzyme.finance/vault/0x591e7194fee6f5615ea89000318e630eab92fbe1?network=arbitrum'
  },
  base: {
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
  const [theme, setTheme] = useState(localStorage.getItem('g12-theme') || 'dark');
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
  const [cooldownSeconds, setCooldownSeconds] = useState(120); // Default, will be updated from API

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
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  const formatCooldownDisplay = () => {
    if (cooldownSeconds < 3600) {
      return `${Math.floor(cooldownSeconds / 60)}-minute`;
    } else {
      return `${Math.floor(cooldownSeconds / 3600)}-hour`;
    }
  };

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';
  const avatarText = address ? address.slice(2, 4).toUpperCase() : '0x';

  const showNotification = (message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // ========== REDEMPTION API FUNCTIONS ==========
  const fetchPendingRedemptions = useCallback(async () => {
    if (!address) return;
    
    try {
      const res = await fetch(`${REDEMPTION_API_URL}?action=pending&wallet=${address}`);
      const data = await res.json();
      
      if (data.error) throw new Error(data.error);
      
      // Update cooldown from server
      if (data.cooldown_seconds) {
        setCooldownSeconds(data.cooldown_seconds);
      }
      
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
      body: JSON.stringify({
        wallet_address: address,
        vault,
        shares_amount: sharesAmount,
        estimated_usdc_value: estimatedUsdc
      })
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

  // Theme toggle
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('g12-theme', theme);
  }, [theme]);

  // Fetch vault data from API
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

  // Fetch user balances from blockchain
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

  // Fetch pending redemptions on mount
  useEffect(() => {
    fetchPendingRedemptions();
  }, [fetchPendingRedemptions]);

  // Countdown timer effect
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

  // Calculate user's vault value in USD
  const getUserVaultValue = (vaultKey) => {
    const shares = Number(userVaultBalances[vaultKey]) / 1e18;
    const sharePrice = vaultData[vaultKey]?.share_price || 1;
    return shares * sharePrice;
  };

  const totalBalance = getUserVaultValue('arb') + getUserVaultValue('base');

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

      // Approve
      const usdcContract = getContract({ client, chain: vault.chain, address: vault.denominationAsset, abi: ERC20_ABI });
      const approveTx = prepareContractCall({ contract: usdcContract, method: 'approve', params: [comptrollerAddr, amount] });
      await sendTransaction({ transaction: approveTx, account });

      // Deposit
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

  // ========== REDEMPTION REQUEST FUNCTION ==========
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
      // Calculate estimated USDC value
      const sharePrice = vaultData[vaultKey]?.share_price || 1;
      const estimatedUsdc = sharesAmount * sharePrice;

      // Create redemption request via API
      const request = await createRedemptionRequest(vaultKey, sharesAmount, estimatedUsdc);
      
      setPendingRedemptions(prev => ({ ...prev, [vaultKey]: request }));
      
      showNotification(`Redemption request submitted! You can withdraw in ${formatCountdown(cooldownSeconds * 1000)}`, 'success');
      setRedeemAmount('');
      
    } catch (err) {
      console.error('Redemption request error:', err);
      showNotification(err.message || 'Failed to submit request', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // ========== EXECUTE REDEMPTION (after cooldown) ==========
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

      // Update status via API
      await updateRedemptionStatus(pending.id, 'completed', result?.transactionHash);
      
      showNotification(`Successfully redeemed ${pending.shares_amount} shares!`, 'success');
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

  // Cancel pending redemption
  const cancelRedemption = async (vaultKey) => {
    const pending = pendingRedemptions[vaultKey];
    if (!pending) return;

    try {
      await updateRedemptionStatus(pending.id, 'cancelled');
      setPendingRedemptions(prev => ({ ...prev, [vaultKey]: null }));
      showNotification('Redemption request cancelled', 'info');
    } catch (err) {
      console.error('Cancel error:', err);
      showNotification('Failed to cancel request', 'error');
    }
  };

  const handleLogout = async () => {
    if (wallet) {
      await disconnect(wallet);
    }
  };

  const navItems = [
    { id: 'overview', icon: '📊', label: 'Overview' },
    { id: 'vaults', icon: '🏦', label: 'Vaults' },
    { id: 'transactions', icon: '↔️', label: 'Transactions' },
    { id: 'settings', icon: '⚙️', label: 'Settings' },
  ];

  // Check if a vault has a pending redemption
  const hasPendingRedemption = (vaultKey) => !!pendingRedemptions[vaultKey];
  const isRedemptionReady = (vaultKey) => hasPendingRedemption(vaultKey) && countdowns[vaultKey] === 0;

  return (
    <div className="dashboard">
      {/* Notification */}
      {notification && (
        <div className={`notification ${notification.type}`}>
          {notification.type === 'success' ? '✅' : notification.type === 'error' ? '❌' : 'ℹ️'} {notification.message}
        </div>
      )}

      {/* Deposit Modal */}
      {depositModal.open && (
        <div className="modal-overlay" onClick={() => setDepositModal({ open: false, vault: 'arb' })}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setDepositModal({ open: false, vault: 'arb' })}>✕</button>
            <h2 className="modal-title">Deposit Funds</h2>
            <p className="modal-desc">Deposit USDC into the vault to start earning yield.</p>
            
            <div className="input-group">
              <label className="input-label">Select Vault</label>
              <select 
                className="input-field" 
                value={depositModal.vault}
                onChange={(e) => setDepositModal({ ...depositModal, vault: e.target.value })}
              >
                <option value="arb">DeFi Yield (Arbitrum) - TEST</option>
                <option value="base" disabled>Stable Yield (Base) - Coming Soon</option>
              </select>
            </div>
            
            <div className="input-group">
              <label className="input-label">Amount (USDC)</label>
              <input 
                type="number" 
                className="input-field" 
                placeholder="0.00" 
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
              />
              <div className="input-helper">
                <span>Balance: {(Number(userUsdcBalances[depositModal.vault]) / 1e6).toFixed(2)} USDC</span>
                <span 
                  className="max-btn"
                  onClick={() => setDepositAmount((Number(userUsdcBalances[depositModal.vault]) / 1e6).toFixed(2))}
                >
                  MAX
                </span>
              </div>
            </div>
            
            <button 
              className="btn btn-primary btn-block" 
              onClick={handleDeposit}
              disabled={isProcessing}
            >
              {isProcessing ? '⏳ Processing...' : '✅ Confirm Deposit'}
            </button>
          </div>
        </div>
      )}

      {/* Redeem Modal */}
      {redeemModal.open && (
        <div className="modal-overlay" onClick={() => setRedeemModal({ open: false, vault: 'arb' })}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setRedeemModal({ open: false, vault: 'arb' })}>✕</button>
            <h2 className="modal-title">Request Redemption</h2>
            
            {/* Pending Redemption Status */}
            {hasPendingRedemption(redeemModal.vault) ? (
              <div className="redemption-status">
                {isRedemptionReady(redeemModal.vault) ? (
                  <>
                    <div className="status-badge ready">
                      <span className="status-icon">✅</span>
                      <span>Ready to withdraw!</span>
                    </div>
                    <div className="pending-details">
                      <p>Amount: <strong>{pendingRedemptions[redeemModal.vault]?.shares_amount.toFixed(6)} shares</strong></p>
                      <p>Est. value: <strong>{fmtUsd(pendingRedemptions[redeemModal.vault]?.estimated_usdc_value)}</strong></p>
                    </div>
                    <div className="modal-actions">
                      <button 
                        className="btn btn-primary btn-block" 
                        onClick={executeRedemption}
                        disabled={isProcessing}
                      >
                        {isProcessing ? '⏳ Processing...' : '💰 Complete Withdrawal'}
                      </button>
                      <button 
                        className="btn btn-secondary btn-block" 
                        onClick={() => cancelRedemption(redeemModal.vault)}
                      >
                        Cancel Request
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="status-badge pending">
                      <span className="status-icon">⏳</span>
                      <span>Withdrawal pending</span>
                    </div>
                    <div className="countdown-display">
                      <div className="countdown-label">Time remaining</div>
                      <div className="countdown-value">{formatCountdown(countdowns[redeemModal.vault])}</div>
                    </div>
                    <div className="pending-details">
                      <p>Amount: <strong>{pendingRedemptions[redeemModal.vault]?.shares_amount.toFixed(6)} shares</strong></p>
                      <p>Est. value: <strong>{fmtUsd(pendingRedemptions[redeemModal.vault]?.estimated_usdc_value)}</strong></p>
                    </div>
                    <div className="cooldown-info">
                      <span className="info-icon">ℹ️</span>
                      <p>This waiting period ensures sufficient liquidity for all withdrawals. You'll be able to complete your withdrawal once the countdown expires.</p>
                    </div>
                    <button 
                      className="btn btn-secondary btn-block" 
                      onClick={() => cancelRedemption(redeemModal.vault)}
                    >
                      Cancel Request
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
                <p className="modal-desc">Request a withdrawal from the vault. A waiting period applies to ensure liquidity.</p>
                
                <div className="cooldown-warning">
                  <span className="warning-icon">⏱️</span>
                  <div>
                    <strong>{formatCooldownDisplay()} waiting period</strong>
                    <p>After submitting, you'll need to wait before completing the withdrawal.</p>
                  </div>
                </div>
                
                <div className="input-group">
                  <label className="input-label">Select Vault</label>
                  <select 
                    className="input-field" 
                    value={redeemModal.vault}
                    onChange={(e) => setRedeemModal({ ...redeemModal, vault: e.target.value })}
                  >
                    <option value="arb">DeFi Yield (Arbitrum) - TEST</option>
                    <option value="base" disabled>Stable Yield (Base) - Coming Soon</option>
                  </select>
                </div>
                
                <div className="input-group">
                  <label className="input-label">Amount (Shares)</label>
                  <input 
                    type="number" 
                    className="input-field" 
                    placeholder="0.00" 
                    value={redeemAmount}
                    onChange={(e) => setRedeemAmount(e.target.value)}
                  />
                  <div className="input-helper">
                    <span>Your shares: {(Number(userVaultBalances[redeemModal.vault]) / 1e18).toFixed(6)}</span>
                    <span 
                      className="max-btn"
                      onClick={() => setRedeemAmount((Number(userVaultBalances[redeemModal.vault]) / 1e18).toFixed(6))}
                    >
                      MAX
                    </span>
                  </div>
                  {redeemAmount && (
                    <div className="estimated-value">
                      Est. value: {fmtUsd(parseFloat(redeemAmount) * (vaultData[redeemModal.vault]?.share_price || 1))}
                    </div>
                  )}
                </div>
                
                <button 
                  className="btn btn-primary btn-block" 
                  onClick={handleRedemptionRequest}
                  disabled={isProcessing}
                >
                  {isProcessing ? '⏳ Processing...' : '📝 Submit Redemption Request'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <a href="/" className="sidebar-brand">
            <img src="/logo_g12.svg" alt="G12 Labs" />
            <span>G12 LABS</span>
          </a>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">
            <div className="nav-section-title">Menu</div>
            {navItems.slice(0, 3).map((item) => (
              <div
                key={item.id}
                className={`nav-item ${activePanel === item.id ? 'active' : ''}`}
                onClick={() => setActivePanel(item.id)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>

          <div className="nav-section">
            <div className="nav-section-title">Resources</div>
            <a href="/strategies.html" className="nav-item">
              <span className="nav-icon">📈</span>
              <span>Strategies</span>
            </a>
            <a href="/docs.html" className="nav-item">
              <span className="nav-icon">📚</span>
              <span>Documentation</span>
            </a>
          </div>

          <div className="nav-section">
            <div className="nav-section-title">Account</div>
            <div
              className={`nav-item ${activePanel === 'settings' ? 'active' : ''}`}
              onClick={() => setActivePanel('settings')}
            >
              <span className="nav-icon">⚙️</span>
              <span>Settings</span>
            </div>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{avatarText}</div>
            <div className="user-info">
              <div className="user-address">{shortAddress}</div>
              <div className="user-network">
                <span className="dot"></span>
                <span>Connected</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <h1 className="page-title">
              {navItems.find((n) => n.id === activePanel)?.label || 'Overview'}
            </h1>
          </div>
          <div className="topbar-right">
            <button
              className="topbar-btn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title="Toggle theme"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button
              className="topbar-btn"
              onClick={() => window.location.reload()}
              title="Refresh"
            >
              🔄
            </button>
            <button
              className="topbar-btn"
              onClick={handleLogout}
              title="Disconnect"
            >
              🚪
            </button>
          </div>
        </header>

        <div className="content-area">
          {/* Overview Panel */}
          {activePanel === 'overview' && (
            <section className="panel-section">
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-label">💰 Total Balance</div>
                  <div className="stat-value">{fmtUsd(totalBalance)}</div>
                  <div className="stat-change positive">—</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">📈 Net APY</div>
                  <div className="stat-value">
                    {vaultData.arb ? fmtPercent(vaultData.arb.monthly_return * 12) : '—%'}
                  </div>
                  <div className="stat-change">Weighted average</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">🪙 Total Deposits</div>
                  <div className="stat-value">{fmtUsd(totalBalance)}</div>
                  <div className="stat-change">0 transactions</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">🏆 Total Earnings</div>
                  <div className="stat-value">$0.00</div>
                  <div className="stat-change positive">Since first deposit</div>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <div className="card-title">⚡ Quick Actions</div>
                </div>
                <div className="quick-actions">
                  <button className="btn btn-primary" onClick={() => setDepositModal({ open: true, vault: 'arb' })}>
                    ➕ Deposit
                  </button>
                  <button 
                    className={`btn ${hasPendingRedemption('arb') ? 'btn-warning' : 'btn-secondary'}`}
                    onClick={() => setRedeemModal({ open: true, vault: 'arb' })}
                  >
                    {hasPendingRedemption('arb') 
                      ? (isRedemptionReady('arb') ? '💰 Complete Withdrawal' : `⏳ ${formatCountdown(countdowns.arb)}`)
                      : '➖ Redeem'
                    }
                  </button>
                  <a
                    href="https://widget.mtpelerin.com/?type=web&lang=en&tab=buy&bdc=USDC&net=ARBITRUM&amt=500&cur=EUR"
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary"
                  >
                    💳 Buy USDC
                  </a>
                </div>
              </div>
            </section>
          )}

          {/* Vaults Panel */}
          {activePanel === 'vaults' && (
            <section className="panel-section">
              <div className="vault-grid">
                {/* Arbitrum Vault */}
                <div className="vault-card">
                  <div className="vault-header">
                    <div className="vault-name">
                      <div className="vault-icon arb">📈</div>
                      <div>
                        <div className="vault-title">DeFi Yield <span className="test-badge">TEST</span></div>
                        <div className="vault-network">Arbitrum</div>
                      </div>
                    </div>
                    <div className="vault-apy">
                      <div className="vault-apy-label">Net APY</div>
                      <div className="vault-apy-value">
                        {vaultData.arb ? fmtPercent(vaultData.arb.monthly_return * 12) : '—%'}
                      </div>
                    </div>
                  </div>
                  <div className="vault-body">
                    <div className="vault-stats">
                      <div>
                        <div className="vault-stat-label">Your Balance</div>
                        <div className="vault-stat-value">{fmtUsd(getUserVaultValue('arb'))}</div>
                      </div>
                      <div>
                        <div className="vault-stat-label">Share Price</div>
                        <div className="vault-stat-value">
                          {vaultData.arb ? `$${Number(vaultData.arb.share_price).toFixed(4)}` : '$—'}
                        </div>
                      </div>
                      <div>
                        <div className="vault-stat-label">Total AUM</div>
                        <div className="vault-stat-value">
                          {vaultData.arb ? fmtUsd(vaultData.arb.aum) : '$—'}
                        </div>
                      </div>
                    </div>
                    <div className="vault-actions">
                      <button className="btn btn-primary btn-sm" onClick={() => setDepositModal({ open: true, vault: 'arb' })}>
                        ➕ Deposit
                      </button>
                      <button 
                        className={`btn btn-sm ${hasPendingRedemption('arb') ? 'btn-warning' : 'btn-secondary'}`}
                        onClick={() => setRedeemModal({ open: true, vault: 'arb' })}
                      >
                        {hasPendingRedemption('arb') 
                          ? (isRedemptionReady('arb') ? '💰 Withdraw' : `⏳ ${formatCountdown(countdowns.arb)}`)
                          : '➖ Redeem'
                        }
                      </button>
                      <a
                        href={ENZYME_VAULTS.arb.enzymeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-secondary btn-sm"
                      >
                        🔗 Details
                      </a>
                    </div>
                  </div>
                </div>

                {/* Base Vault */}
                <div className="vault-card">
                  <div className="vault-header">
                    <div className="vault-name">
                      <div className="vault-icon base">🛡️</div>
                      <div>
                        <div className="vault-title">Stable Yield</div>
                        <div className="vault-network">Base</div>
                      </div>
                    </div>
                    <div className="vault-apy">
                      <div className="vault-apy-label">Net APY</div>
                      <div className="vault-apy-value">
                        {vaultData.base ? fmtPercent(vaultData.base.monthly_return * 12) : '—%'}
                      </div>
                    </div>
                  </div>
                  <div className="vault-body">
                    <div className="vault-stats">
                      <div>
                        <div className="vault-stat-label">Your Balance</div>
                        <div className="vault-stat-value">{fmtUsd(getUserVaultValue('base'))}</div>
                      </div>
                      <div>
                        <div className="vault-stat-label">Share Price</div>
                        <div className="vault-stat-value">
                          {vaultData.base ? `$${Number(vaultData.base.share_price).toFixed(4)}` : '$—'}
                        </div>
                      </div>
                      <div>
                        <div className="vault-stat-label">Total AUM</div>
                        <div className="vault-stat-value">
                          {vaultData.base ? fmtUsd(vaultData.base.aum) : '$—'}
                        </div>
                      </div>
                    </div>
                    <div className="vault-actions">
                      <button className="btn btn-primary btn-sm" disabled>
                        ➕ Deposit
                      </button>
                      <button className="btn btn-secondary btn-sm" disabled>
                        ➖ Redeem
                      </button>
                      <a href="/strategies.html" className="btn btn-secondary btn-sm">
                        ℹ️ Details
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Transactions Panel */}
          {activePanel === 'transactions' && (
            <section className="panel-section">
              <div className="card">
                <div className="card-header">
                  <div className="card-title">🕐 Transaction History</div>
                </div>
                <div className="empty-state">
                  <div className="empty-icon">📄</div>
                  <div className="empty-title">No transactions yet</div>
                  <p className="empty-text">
                    Your deposit and withdrawal history will appear here once you start using the vaults.
                  </p>
                  <button className="btn btn-primary" onClick={() => setActivePanel('vaults')}>
                    ➕ Make your first deposit
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Settings Panel */}
          {activePanel === 'settings' && (
            <section className="panel-section">
              <div className="settings-grid">
                <div className="settings-section">
                  <h3 className="settings-title">🎨 Appearance</h3>
                  <div className="setting-row">
                    <div className="setting-info">
                      <h4>Dark Mode</h4>
                      <p>Switch between light and dark themes</p>
                    </div>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={theme === 'dark'}
                        onChange={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>
                </div>

                <div className="settings-section">
                  <h3 className="settings-title">💼 Wallet</h3>
                  <div className="setting-row">
                    <div className="setting-info">
                      <h4>Connected Address</h4>
                      <p className="mono">{address}</p>
                    </div>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => navigator.clipboard.writeText(address)}
                    >
                      📋 Copy
                    </button>
                  </div>
                  <div className="setting-row">
                    <div className="setting-info">
                      <h4>Disconnect Wallet</h4>
                      <p>End your current session</p>
                    </div>
                    <button className="btn btn-secondary btn-sm danger" onClick={handleLogout}>
                      🚪 Disconnect
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

export default Dashboard;