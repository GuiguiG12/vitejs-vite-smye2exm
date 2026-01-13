import { useState, useEffect } from 'react';
import { useDisconnect, useActiveWallet } from 'thirdweb/react';

const API_URL =
  'https://ucrvaqztvfnphhoqcbpo.supabase.co/functions/v1/FIRECRAWL_DATA';

function Dashboard({ address }) {
  const { disconnect } = useDisconnect();
  const wallet = useActiveWallet();
  const [activePanel, setActivePanel] = useState('overview');
  const [theme, setTheme] = useState(
    localStorage.getItem('g12-theme') || 'dark'
  );
  const [vaultData, setVaultData] = useState({ arb: null, base: null });
  const [loading, setLoading] = useState(true);

  // Format helpers
  const fmtUsd = (v) => {
    if (v == null || isNaN(Number(v))) return '$—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(Number(v));
  };

  const fmtPercent = (v) => {
    if (v == null) return '—%';
    const n = Number(v);
    if (isNaN(n)) return '—%';
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  };

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : '';
  const avatarText = address ? address.slice(2, 4).toUpperCase() : '0x';

  // Theme toggle
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('g12-theme', theme);
  }, [theme]);

  // Fetch vault data
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [arbRes, baseRes] = await Promise.all([
          fetch(`${API_URL}?action=get&network=arbitrum`),
          fetch(`${API_URL}?action=get&network=base`),
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

  return (
    <div className="dashboard">
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
                className={`nav-item ${
                  activePanel === item.id ? 'active' : ''
                }`}
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
              className={`nav-item ${
                activePanel === 'settings' ? 'active' : ''
              }`}
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
                  <div className="stat-value">$0.00</div>
                  <div className="stat-change positive">—</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">📈 Net APY</div>
                  <div className="stat-value">
                    {vaultData.arb
                      ? fmtPercent(vaultData.arb.monthly_return * 12)
                      : '—%'}
                  </div>
                  <div className="stat-change">Weighted average</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">🪙 Total Deposits</div>
                  <div className="stat-value">$0.00</div>
                  <div className="stat-change">0 transactions</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">🏆 Total Earnings</div>
                  <div className="stat-value">$0.00</div>
                  <div className="stat-change positive">
                    Since first deposit
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <div className="card-title">⚡ Quick Actions</div>
                </div>
                <div className="quick-actions">
                  <button className="btn btn-primary">➕ Deposit</button>
                  <button className="btn btn-secondary">➖ Redeem</button>
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
                        <div className="vault-title">DeFi Yield</div>
                        <div className="vault-network">Arbitrum</div>
                      </div>
                    </div>
                    <div className="vault-apy">
                      <div className="vault-apy-label">Net APY</div>
                      <div className="vault-apy-value">
                        {vaultData.arb
                          ? fmtPercent(vaultData.arb.monthly_return * 12)
                          : '—%'}
                      </div>
                    </div>
                  </div>
                  <div className="vault-body">
                    <div className="vault-stats">
                      <div>
                        <div className="vault-stat-label">Your Balance</div>
                        <div className="vault-stat-value">$0.00</div>
                      </div>
                      <div>
                        <div className="vault-stat-label">Share Price</div>
                        <div className="vault-stat-value">
                          {vaultData.arb
                            ? `$${Number(vaultData.arb.share_price).toFixed(4)}`
                            : '$—'}
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
                      <button className="btn btn-primary btn-sm">
                        ➕ Deposit
                      </button>
                      <button className="btn btn-secondary btn-sm">
                        ➖ Redeem
                      </button>
                      <a
                        href="/strategies.html"
                        className="btn btn-secondary btn-sm"
                      >
                        ℹ️ Details
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
                        {vaultData.base
                          ? fmtPercent(vaultData.base.monthly_return * 12)
                          : '—%'}
                      </div>
                    </div>
                  </div>
                  <div className="vault-body">
                    <div className="vault-stats">
                      <div>
                        <div className="vault-stat-label">Your Balance</div>
                        <div className="vault-stat-value">$0.00</div>
                      </div>
                      <div>
                        <div className="vault-stat-label">Share Price</div>
                        <div className="vault-stat-value">
                          {vaultData.base
                            ? `$${Number(vaultData.base.share_price).toFixed(
                                4
                              )}`
                            : '$—'}
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
                      <button className="btn btn-primary btn-sm">
                        ➕ Deposit
                      </button>
                      <button className="btn btn-secondary btn-sm">
                        ➖ Redeem
                      </button>
                      <a
                        href="/strategies.html"
                        className="btn btn-secondary btn-sm"
                      >
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
                    Your deposit and withdrawal history will appear here once
                    you start using the vaults.
                  </p>
                  <button
                    className="btn btn-primary"
                    onClick={() => setActivePanel('vaults')}
                  >
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
                        onChange={() =>
                          setTheme(theme === 'dark' ? 'light' : 'dark')
                        }
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
                    <button
                      className="btn btn-secondary btn-sm danger"
                      onClick={handleLogout}
                    >
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
