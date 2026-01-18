import { useEffect, useRef } from 'react';
import { ConnectButton } from 'thirdweb/react';
import { createThirdwebClient } from 'thirdweb';
import { arbitrum, base } from 'thirdweb/chains';

const client = createThirdwebClient({ clientId: 'ef76c96ae163aba05ebd7e20d94b81fd' });

function LoginView() {
  const tickerRef = useRef(null);

  // Ticker animation on mount
  useEffect(() => {
    const el = tickerRef.current;
    if (!el) return;

    const target = 3457.69;
    const duration = 2500;
    const frameDuration = 1000 / 60;
    const totalFrames = Math.round(duration / frameDuration);
    const easeOut = t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    
    let frame = 0;
    
    const timeout = setTimeout(() => {
      const counter = setInterval(() => {
        frame++;
        const progress = easeOut(frame / totalFrames);
        const current = target * progress;
        
        el.textContent = "$" + current.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
        
        if (frame === totalFrames) {
          clearInterval(counter);
        }
      }, frameDuration);
    }, 500);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="login-view">
      {/* LEFT SIDE - LIGHT THEME */}
      <div className="login-left">
        <div className="brand-logo">
          <img src="/logo_g12.svg" alt="G12 Labs" />
          <span className="brand-text">G12 LABS</span>
        </div>

        <div className="hero-text">
          <h1>Institutional DeFi.<br />Zero Friction.</h1>
          <p>
            Access our automated yield strategies on Arbitrum & Base. 
            Real-time risk management, transparent reporting, and non-custodial security.
          </p>
        </div>

        <div className="connect-container">
          <ConnectButton
            client={client}
            chains={[arbitrum, base]}
            connectButton={{
              label: 'Get Started',
              className: 'btn-get-started',
            }}
            connectModal={{
              size: 'wide',
              title: 'Connect to G12 Labs',
              showThirdwebBranding: false,
            }}
          />
        </div>
      </div>

      {/* RIGHT SIDE - DARK THEME WITH MOCKUP */}
      <div className="login-right">
        <div className="grid-bg"></div>
        
        <div className="mockup-scene">
          {/* Floating Mobile Device */}
          <div className="device-mobile">
            <div className="dynamic-island"></div>
            <div className="m-screen">
              <div className="m-header">
                <div className="m-title">Buy / Sell</div>
                <i className="ph ph-list" style={{ color: 'white', fontSize: '20px' }}></i>
              </div>
              
              <div className="m-body">
                <div className="m-card">
                  <div className="m-card-head">
                    <div className="m-asset"><img src="/favicon_arbitrum.svg" alt="Arbitrum" /> DeFi Yield</div>
                    <span className="m-badge">Arbitrum</span>
                  </div>
                  <div className="m-stats">
                    <div className="m-stat"><label>Share Price</label><span>$1.075</span></div>
                    <div className="m-stat"><label>Net APY</label><span className="m-apy">+84.24%</span></div>
                    <div className="m-stat"><label>Your Balance</label><span>$3,457.69</span></div>
                    <div className="m-stat"><label>Your Shares</label><span>2,840.00</span></div>
                  </div>
                  <div className="m-actions">
                    <div className="m-btn fill"><i className="ph ph-plus"></i><span>Deposit</span></div>
                    <div className="m-btn outline"><i className="ph ph-minus"></i><span>Redeem</span></div>
                  </div>
                </div>

                <div className="m-card">
                  <div className="m-card-head">
                    <div className="m-asset"><img src="/favicon_base.jpeg" style={{ borderRadius: '50%' }} alt="Base" /> Stable Yield</div>
                    <span className="m-badge">Base</span>
                  </div>
                  <div className="m-stats">
                    <div className="m-stat"><label>Share Price</label><span>$1.000</span></div>
                    <div className="m-stat"><label>Net APY</label><span className="m-apy">+2.64%</span></div>
                    <div className="m-stat"><label>Your Balance</label><span>$0.00</span></div>
                    <div className="m-stat"><label>Your Shares</label><span>0.0000</span></div>
                  </div>
                  <div className="m-actions">
                    <div className="m-btn fill"><i className="ph ph-plus"></i><span>Deposit</span></div>
                    <div className="m-btn outline"><i className="ph ph-minus"></i><span>Redeem</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Main Desktop Device */}
          <div className="device-desktop">
            <div className="screen">
              {/* Sidebar */}
              <div className="s-sidebar">
                <div className="s-brand"><img src="/logo_g12.svg" height="24" alt="G12" /> G12 LABS</div>
                <div className="s-section-title">MAIN MENU</div>
                <div className="s-item active"><i className="ph ph-squares-four"></i> Dashboard</div>
                <div className="s-item"><i className="ph ph-arrows-left-right"></i> Buy / Sell</div>
                <div className="s-item"><i className="ph ph-list-dashes"></i> Transactions</div>
                <div className="s-section-title">ANALYTICS</div>
                <div className="s-item"><i className="ph ph-chart-line-up"></i> Strategies</div>
                <div style={{ marginTop: 'auto' }}></div>
                <div className="s-item"><i className="ph ph-gear"></i> Settings</div>
              </div>

              {/* Main Content */}
              <div className="s-main">
                <div className="s-topbar">
                  <div className="s-bread">Dashboard / <span>Overview</span></div>
                  <div className="s-top-right">
                    <div className="s-refresh"><i className="ph ph-arrows-clockwise"></i></div>
                    <div className="s-wallet">
                      <div className="s-avatar"></div> 0x71C...9A21
                    </div>
                  </div>
                </div>

                <div className="s-body">
                  {/* Portfolio Card */}
                  <div className="card-portfolio">
                    <div className="cp-header">
                      <div>
                        <div className="cp-label">Total Portfolio</div>
                        <div className="cp-val" ref={tickerRef}>$0.00</div>
                        <div className="cp-change"><i className="ph ph-trend-up"></i> +$41.00 (1.2%) <span style={{ fontWeight: 400, color: '#666', marginLeft: '4px' }}>(1W)</span></div>
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <div className="range-active">1W</div>
                        <div className="range-inactive">1M</div>
                      </div>
                    </div>
                    <div className="chart-container">
                      <svg className="chart" viewBox="0 0 400 120" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id="grad" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="#E85A04" stopOpacity="0.3" />
                            <stop offset="100%" stopColor="#E85A04" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <path className="area" d="M0,120 L0,100 C40,100 60,110 100,90 C140,70 160,85 200,60 C240,35 280,50 320,30 C360,10 380,20 400,5 L400,120 Z" />
                        <path className="line" d="M0,100 C40,100 60,110 100,90 C140,70 160,85 200,60 C240,35 280,50 320,30 C360,10 380,20 400,5" vectorEffect="non-scaling-stroke" />
                      </svg>
                    </div>
                  </div>

                  {/* Wallet Card */}
                  <div className="card-wallet">
                    <div>
                      <div className="cp-label">Wallet Balance</div>
                      <div className="cw-bal-row">
                        <div className="cw-bal">4,250.00 <span style={{ fontSize: '14px', fontWeight: 400, color: '#666' }}>USDC</span></div>
                      </div>
                    </div>
                    <div className="cw-actions">
                      <div className="cw-btn primary"><i className="ph ph-arrow-down"></i> Deposit</div>
                      <div className="cw-btn"><i className="ph ph-arrow-up"></i> Withdraw</div>
                    </div>
                  </div>

                  {/* Positions Card */}
                  <div className="card-positions">
                    <div className="row-title"><i className="ph ph-wallet"></i> Your Positions</div>
                    <div className="pos-item-login">
                      <div className="pos-left">
                        <img src="/favicon_arbitrum.svg" className="pos-icon" alt="Arbitrum" />
                        <div className="pos-info">
                          <div>DeFi Yield</div>
                          <div>Arbitrum</div>
                        </div>
                      </div>
                      <div className="pos-right">
                        <div className="pos-apy">+84.24%</div>
                        <div className="pos-val">$3,457.69</div>
                      </div>
                    </div>
                  </div>

                  {/* Activity Card */}
                  <div className="card-activity">
                    <div className="row-title"><i className="ph ph-clock-counter-clockwise"></i> Recent Activity</div>
                    <div className="act-list">
                      <div className="act-item-login">
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <div className="act-icon"><i className="ph ph-arrow-down"></i></div>
                          <div className="act-info">
                            <div>Deposit</div>
                            <div>DeFi Yield • Jan 17</div>
                          </div>
                        </div>
                        <div className="act-val">+$500.00</div>
                      </div>
                      <div className="act-item-login">
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <div className="act-icon"><i className="ph ph-arrow-down"></i></div>
                          <div className="act-info">
                            <div>Deposit</div>
                            <div>DeFi Yield • Jan 15</div>
                          </div>
                        </div>
                        <div className="act-val">+$15,000.00</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginView;