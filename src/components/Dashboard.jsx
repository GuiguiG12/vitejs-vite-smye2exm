import { useState, useEffect, useCallback, useRef } from 'react';
import { useDisconnect, useActiveWallet } from 'thirdweb/react';
import { getContract, readContract, prepareContractCall, sendTransaction } from 'thirdweb';
import { createThirdwebClient } from 'thirdweb';
import { arbitrum, base } from 'thirdweb/chains';

const client = createThirdwebClient({ clientId: 'ef76c96ae163aba05ebd7e20d94b81fd' });

// API
const VAULT_API_URL = 'https://ucrvaqztvfnphhoqcbpo.supabase.co/functions/v1/FIRECRAWL_DATA';
const REDEMPTION_API_URL = 'https://ucrvaqztvfnphhoqcbpo.supabase.co/functions/v1/REDEMPTION_API';

// Config
const ENZYME_VAULTS = {
  arb: { name: 'DeFi Yield', network: 'Arbitrum', icon: '/favicon_arbitrum.svg', vaultProxy: '0xc9e50e08739a4aec211f2e8e95f1ab45b923cc20', denominationAsset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', chain: arbitrum },
  base: { name: 'Stable Yield', network: 'Base', icon: '/favicon_base.jpeg', vaultProxy: '0xbfa811e1f065c9b66b02d8ae408d4d9b9be70a22', denominationAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', chain: base }
};

// ABIs
const VAULT_ABI = [{ name: 'getAccessor', type: 'function', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' }, { name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }];
const COMPTROLLER_ABI = [{ name: 'buyShares', type: 'function', inputs: [{ name: '_investmentAmount', type: 'uint256' }, { name: '_minSharesQuantity', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'nonpayable' }, { name: 'redeemSharesForSpecificAssets', type: 'function', inputs: [{ name: '_recipient', type: 'address' }, { name: '_sharesQuantity', type: 'uint256' }, { name: '_payoutAssets', type: 'address[]' }, { name: '_payoutAssetPercentages', type: 'uint256[]' }], outputs: [{ type: 'address[]' }, { type: 'uint256[]' }], stateMutability: 'nonpayable' }];
const ERC20_ABI = [{ name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }, { name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }];

function Dashboard({ address }) {
  const { disconnect } = useDisconnect();
  const wallet = useActiveWallet();
  const [activePanel, setActivePanel] = useState('overview');
  const [theme, setTheme] = useState('dark');
  
  // Data State
  const [vaultData, setVaultData] = useState({ arb: null, base: null });
  const [userVaultBalances, setUserVaultBalances] = useState({ arb: 0n, base: 0n });
  const [userUsdcBalances, setUserUsdcBalances] = useState({ arb: 0n, base: 0n });
  const [comptrollerAddresses, setComptrollerAddresses] = useState({ arb: null, base: null });
  const [transactions, setTransactions] = useState([]); 

  // Modals
  const [depositModal, setDepositModal] = useState({ open: false, vault: 'arb' });
  const [redeemModal, setRedeemModal] = useState({ open: false, vault: 'arb' });
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Formatters
  const fmtUsd = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v) || 0);
  const fmtPercent = (v) => (Number(v) ? (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(2) + '%' : '—');
  const shortAddress = address ? `${address.slice(0,6)}...${address.slice(-4)}` : '';

  // --- THEME EFFECT (FIX) ---
  useEffect(() => {
    // Applique l'attribut data-theme au tag <html>
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // --- DATA LOADING ---
  const loadData = useCallback(async () => {
    // 1. Vault Stats (API)
    try {
      const [arb, base] = await Promise.all([
        fetch(`${VAULT_API_URL}?action=get&network=arbitrum`).then(r => r.json()),
        fetch(`${VAULT_API_URL}?action=get&network=base`).then(r => r.json())
      ]);
      setVaultData({ arb, base });
    } catch (e) { console.error(e); }

    // 2. User Balances (Chain)
    if (address) {
      for (const [key, vault] of Object.entries(ENZYME_VAULTS)) {
        if (!vault.vaultProxy) continue;
        try {
          const vc = getContract({ client, chain: vault.chain, address: vault.vaultProxy, abi: VAULT_ABI });
          const shares = await readContract({ contract: vc, method: 'balanceOf', params: [address] });
          const comp = await readContract({ contract: vc, method: 'getAccessor', params: [] });
          const usdcC = getContract({ client, chain: vault.chain, address: vault.denominationAsset, abi: ERC20_ABI });
          const usdc = await readContract({ contract: usdcC, method: 'balanceOf', params: [address] });
          
          setUserVaultBalances(p => ({ ...p, [key]: shares }));
          setUserUsdcBalances(p => ({ ...p, [key]: usdc }));
          setComptrollerAddresses(p => ({ ...p, [key]: comp }));
        } catch(e) { console.error(e); }
      }
    }
  }, [address]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Helpers
  const getUserVaultValue = (key) => {
    const shares = Number(userVaultBalances[key]) / 1e18;
    const price = vaultData[key]?.share_price || 1;
    return shares * price;
  };
  const totalBalance = getUserVaultValue('arb') + getUserVaultValue('base');
  const walletUsdc = (Number(userUsdcBalances.arb) + Number(userUsdcBalances.base)) / 1e6;

  // --- ACTIONS ---
  const handleDeposit = async () => {
    if (!amount) return;
    setIsProcessing(true);
    try {
      const key = depositModal.vault;
      const vault = ENZYME_VAULTS[key];
      const val = BigInt(Math.floor(parseFloat(amount) * 1e6));
      const account = await wallet.getAccount();
      
      const usdcC = getContract({ client, chain: vault.chain, address: vault.denominationAsset, abi: ERC20_ABI });
      const tx1 = prepareContractCall({ contract: usdcC, method: 'approve', params: [comptrollerAddresses[key], val] });
      await sendTransaction({ transaction: tx1, account });
      
      const compC = getContract({ client, chain: vault.chain, address: comptrollerAddresses[key], abi: COMPTROLLER_ABI });
      const tx2 = prepareContractCall({ contract: compC, method: 'buyShares', params: [val, 1n] });
      await sendTransaction({ transaction: tx2, account });
      
      alert('Deposit Successful');
      loadData(); // Refresh data
      setDepositModal({open:false});
    } catch(e) { console.error(e); alert('Error: ' + e.message); }
    setIsProcessing(false);
  };

  const handleRedeem = async () => {
    if (!amount) return;
    setIsProcessing(true);
    try {
      // Logic for redemption would go here
      alert("Redemption request submitted (Demo)");
      setRedeemModal({open:false});
    } catch(e) { alert(e.message); }
    setIsProcessing(false);
  };

  return (
    <div className="dashboard-layout">
      
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <a href="/" className="logo-container">
            <img src="/logo_g12.svg" alt="G12" height="28" />
            <span className="logo-text">G12 LABS</span>
          </a>
        </div>

        <div className="nav-section">
          <div className="nav-label">Main Menu</div>
          <div className={`nav-item ${activePanel === 'overview' ? 'active' : ''}`} onClick={() => setActivePanel('overview')}>
            <i className="ph ph-squares-four"></i> Dashboard
          </div>
          <div className={`nav-item ${activePanel === 'buy-sell' ? 'active' : ''}`} onClick={() => setActivePanel('buy-sell')}>
            <i className="ph ph-arrows-left-right"></i> Buy or Sell
          </div>
          <div className={`nav-item ${activePanel === 'transactions' ? 'active' : ''}`} onClick={() => setActivePanel('transactions')}>
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
          <div className={`nav-item ${activePanel === 'settings' ? 'active' : ''}`} onClick={() => setActivePanel('settings')}>
            <i className="ph ph-gear"></i> Settings
          </div>
          <div className={`nav-item ${activePanel === 'support' ? 'active' : ''}`} onClick={() => setActivePanel('support')}>
            <i className="ph ph-chat-circle"></i> Support
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="disconnect-btn" onClick={() => disconnect(wallet)}>
            <i className="ph ph-sign-out"></i> Disconnect
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">
        
        {/* TOPBAR */}
        <header className="topbar">
          <div className="breadcrumbs">
            Dashboard <span style={{margin:'0 6px'}}>/</span> <span>{activePanel === 'overview' ? 'Overview' : activePanel === 'buy-sell' ? 'Buy or Sell' : 'Transactions'}</span>
          </div>
          
          <div className="topbar-right">
            
            {/* Bouton Refresh ajouté */}
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

        <div className="content-wrapper">
          
          {/* PANEL: OVERVIEW */}
          {activePanel === 'overview' && (
            <>
              <div className="row-top">
                <div className="glass-card portfolio-card">
                  <div className="p-header">
                    <h2>Total Portfolio</h2>
                    <div className="p-balance mono">{fmtUsd(totalBalance)}</div>
                    <div className="p-change"><i className="ph ph-trend-up"></i> +$0.00 (0.00%)</div>
                  </div>
                  <div className="chart-area"><div className="chart-line"></div></div>
                </div>

                <div className="glass-card actions-card">
                  <div className="available-row">
                    <div>
                      <div className="av-label">Wallet Available</div>
                      <div className="av-val mono">{fmtUsd(walletUsdc)}</div>
                    </div>
                  </div>
                  <div className="action-btns">
                    <button className="act-btn primary" onClick={() => setDepositModal({open:true, vault:'arb'})}>
                      <i className="ph ph-arrow-down"></i> Deposit
                    </button>
                    <button className="act-btn" onClick={() => setRedeemModal({open:true, vault:'arb'})}>
                      <i className="ph ph-arrow-up"></i> Withdraw
                    </button>
                  </div>
                </div>
              </div>

              <div className="row-bottom">
                <div className="section-col">
                  <div className="section-title"><i className="ph ph-wallet"></i> Your Positions</div>
                  {totalBalance > 0 ? (
                    <div className="positions-list">
                      {Object.entries(ENZYME_VAULTS).map(([key, vault]) => (
                        <div className="pos-item" key={key} onClick={() => setActivePanel('buy-sell')}>
                          <div className="pos-main">
                            <img src={vault.icon} className="pos-icon" />
                            <div className="pos-info">
                              <h4>{vault.name}</h4>
                              <span>{vault.network}</span>
                            </div>
                          </div>
                          <div className="pos-stats">
                            <div className="pos-stat-grp">
                              <label>APY</label>
                              <span className="pos-apy">{vaultData[key] ? fmtPercent(vaultData[key].monthly_return * 12) : '--'}</span>
                            </div>
                            <div className="pos-stat-grp">
                              <label>Balance</label>
                              <span className="mono">{fmtUsd(getUserVaultValue(key))}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-box">
                      <i className="ph ph-safe"></i>
                      <p>No active strategies. Deposit funds to start generating yield.</p>
                    </div>
                  )}
                </div>

                <div className="section-col">
                  <div className="section-title"><i className="ph ph-clock-counter-clockwise"></i> Recent Activity</div>
                  <div className="glass-card" style={{padding:'0 16px'}}>
                    {transactions.length > 0 ? (
                      <div className="tx-list"></div>
                    ) : (
                      <div style={{padding:'32px', textAlign:'center', color:'var(--text-muted)', fontSize:'13px'}}>
                        No recent activity found.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* PANEL: BUY OR SELL */}
          {activePanel === 'buy-sell' && (
            <div className="vault-grid">
              {Object.entries(ENZYME_VAULTS).map(([key, vault]) => (
                <div className="vault-card" key={key}>
                  <div className="vc-header">
                    <div className="vc-title">
                      <img src={vault.icon} width="32" /> {vault.name}
                    </div>
                    <div className="vc-badges">
                      <span className="badge">{vault.network}</span>
                    </div>
                  </div>
                  <div className="vc-stats">
                    <div className="vc-stat"><label>Share Price</label><span className="mono">{fmtUsd(vaultData[key]?.share_price)}</span></div>
                    <div className="vc-stat"><label>Net APY</label><span style={{color:'var(--success)'}}>{fmtPercent(vaultData[key]?.monthly_return * 12)}</span></div>
                    <div className="vc-stat"><label>Your Balance</label><span className="mono">{fmtUsd(getUserVaultValue(key))}</span></div>
                  </div>
                  <div className="vc-actions">
                    <button className="btn btn-primary" onClick={() => setDepositModal({open:true, vault:key})}>Deposit</button>
                    <button className="btn btn-secondary" onClick={() => setRedeemModal({open:true, vault:key})}>Redeem</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* PANEL: TRANSACTIONS */}
          {activePanel === 'transactions' && (
            <div className="glass-card" style={{padding:0, overflow:'hidden'}}>
              <table className="full-tx-table">
                <thead>
                  <tr><th>Type</th><th>Asset</th><th>Amount</th><th>Status</th><th>Date</th></tr>
                </thead>
                <tbody>
                  <tr><td colSpan="5" style={{textAlign:'center', padding:'40px'}}>No transaction history available.</td></tr>
                </tbody>
              </table>
            </div>
          )}

        </div>
      </main>

      {/* MODALS */}
      {depositModal.open && (
        <div className="modal-overlay" onClick={() => setDepositModal({open:false})}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Deposit USDC</div>
              <button className="close-btn" onClick={() => setDepositModal({open:false})}>×</button>
            </div>
            <div className="input-box">
              <input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
              <span className="max-tag" onClick={() => setAmount((Number(userUsdcBalances[depositModal.vault])/1e6).toString())}>MAX</span>
            </div>
            <div style={{display:'flex', gap:'10px'}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={handleDeposit} disabled={isProcessing}>
                {isProcessing ? 'Processing...' : 'Confirm Deposit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {redeemModal.open && (
        <div className="modal-overlay" onClick={() => setRedeemModal({open:false})}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Redeem / Withdraw</div>
              <button className="close-btn" onClick={() => setRedeemModal({open:false})}>×</button>
            </div>
            <div className="input-box">
              <input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
              <span className="max-tag">MAX</span>
            </div>
            <div style={{display:'flex', gap:'10px'}}>
              <button className="btn btn-secondary" style={{flex:1}} onClick={handleRedeem} disabled={isProcessing}>
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default Dashboard;