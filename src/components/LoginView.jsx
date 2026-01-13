import { ConnectButton } from 'thirdweb/react';
import { createThirdwebClient } from 'thirdweb';
import { inAppWallet, createWallet } from 'thirdweb/wallets';
import { arbitrum, base } from 'thirdweb/chains';

const client = createThirdwebClient({
  clientId: 'ef76c96ae163aba05ebd7e20d94b81fd',
});

const wallets = [
  inAppWallet({
    auth: {
      options: ['google', 'discord', 'email', 'coinbase', 'apple'],
    },
  }),
  createWallet('io.metamask'),
  createWallet('com.coinbase.wallet'),
  createWallet('me.rainbow'),
  createWallet('io.rabby'),
  createWallet('io.zerion.wallet'),
];

function LoginView() {
  return (
    <div className="login-view">
      <div className="login-left">
        <div className="brand-header">
          <img src="/logo_g12.svg" alt="G12 Labs" />
          <span>G12 LABS</span>
        </div>

        <div className="login-hero">
          <h1>
            Systematic DeFi.
            <br />
            Zero Friction.
          </h1>
          <p>
            Connect your wallet or sign in with email to access our
            institutional-grade yield strategies on Arbitrum & Base.
          </p>
        </div>

        <div className="connect-container">
          <ConnectButton
            client={client}
            wallets={wallets}
            chains={[arbitrum, base]}
            connectButton={{
              label: 'Get Started',
              className: 'connect-btn',
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
            <span className="trust-icon">🛡️</span>
            <span>Audited</span>
          </div>
          <div className="trust-item">
            <span className="trust-icon">🔐</span>
            <span>Non-Custodial</span>
          </div>
          <div className="trust-item">
            <span className="trust-icon">⚡</span>
            <span>Automated</span>
          </div>
        </div>
      </div>

      <div className="login-right">
        <div className="grid-pattern"></div>
        <div className="preview-card">
          <div className="preview-header">
            <div className="preview-dots">
              <div className="preview-dot active"></div>
              <div className="preview-dot"></div>
              <div className="preview-dot"></div>
            </div>
            <span className="preview-label">Dashboard Preview</span>
          </div>
          <div className="preview-stats">
            <div className="preview-stat">
              <div className="preview-stat-label">Portfolio Value</div>
              <div className="preview-stat-value">$—</div>
            </div>
            <div className="preview-stat">
              <div className="preview-stat-label">Net APY</div>
              <div className="preview-stat-value accent">—%</div>
            </div>
          </div>
          <div className="preview-chart">
            <svg viewBox="0 0 100 50" preserveAspectRatio="none">
              <path
                d="M0 45 Q20 40, 30 35 T50 30 T70 20 T100 10"
                stroke="#E85A04"
                strokeWidth="1.5"
                fill="none"
                opacity="0.8"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginView;
