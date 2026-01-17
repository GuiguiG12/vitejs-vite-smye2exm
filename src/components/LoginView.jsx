import { ConnectButton } from 'thirdweb/react';
import { createThirdwebClient } from 'thirdweb';
import { arbitrum, base } from 'thirdweb/chains';

const client = createThirdwebClient({ clientId: 'ef76c96ae163aba05ebd7e20d94b81fd' });

function LoginView() {
  return (
    <div className="login-view">
      <div className="login-left">
        <div className="brand-header">
          <img src="/logo_g12.svg" alt="G12 Labs" />
          <span>G12 LABS</span>
        </div>
        
        <div className="login-hero">
          <h1>Institutional-Grade DeFi Yield</h1>
          <p>
            Access systematic, data-driven strategies on Arbitrum and Base. 
            Connect your wallet to deposit, track performance, and manage your portfolio.
          </p>
        </div>
        
        <div className="connect-container">
          <ConnectButton
            client={client}
            chains={[arbitrum, base]}
            connectButton={{
              label: 'Connect Wallet',
            }}
            connectModal={{
              size: 'wide',
              title: 'Connect to G12 Labs',
              showThirdwebBranding: false,
            }}
          />
        </div>
        
        <div className="trust-row">
          <div className="trust-item">
            <span className="trust-icon">🔒</span>
            <span>Non-Custodial</span>
          </div>
          <div className="trust-item">
            <span className="trust-icon">⚡</span>
            <span>Instant Access</span>
          </div>
          <div className="trust-item">
            <span className="trust-icon">🛡️</span>
            <span>Audited</span>
          </div>
        </div>
      </div>
      
      <div className="login-right">
        <div className="grid-pattern"></div>
        <div className="preview-card">
          <div className="preview-header">
            <div className="preview-dots">
              <span className="preview-dot active"></span>
              <span className="preview-dot"></span>
              <span className="preview-dot"></span>
            </div>
            <span className="preview-label">Portfolio Preview</span>
          </div>
          
          <div className="preview-stats">
            <div className="preview-stat">
              <div className="preview-stat-label">Total Balance</div>
              <div className="preview-stat-value">$24,850.00</div>
            </div>
            <div className="preview-stat">
              <div className="preview-stat-label">Net APY</div>
              <div className="preview-stat-value accent">+18.4%</div>
            </div>
            <div className="preview-stat">
              <div className="preview-stat-label">DeFi Yield</div>
              <div className="preview-stat-value">$18,200</div>
            </div>
            <div className="preview-stat">
              <div className="preview-stat-label">Stable Yield</div>
              <div className="preview-stat-value">$6,650</div>
            </div>
          </div>
          
          <div className="preview-chart">
            <svg viewBox="0 0 400 60" preserveAspectRatio="none">
              <path
                d="M0,50 Q50,45 100,35 T200,25 T300,30 T400,20"
                fill="none"
                stroke="#E85A04"
                strokeWidth="2"
                opacity="0.8"
              />
              <path
                d="M0,50 Q50,45 100,35 T200,25 T300,30 T400,20 L400,60 L0,60 Z"
                fill="url(#chartGradient)"
                opacity="0.3"
              />
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#E85A04" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginView;
