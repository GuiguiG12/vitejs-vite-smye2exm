import { useState, useEffect, useCallback } from 'react';
import { useDisconnect, useActiveWallet, useSwitchActiveWalletChain } from 'thirdweb/react';
import { getContract, readContract, prepareContractCall, sendTransaction, waitForReceipt, estimateGas } from 'thirdweb';
import { createThirdwebClient } from 'thirdweb';
import { arbitrum, base } from 'thirdweb/chains';
import { AreaChart, Area, Tooltip, ResponsiveContainer, XAxis, YAxis } from 'recharts';

const client = createThirdwebClient({ clientId: 'ef76c96ae163aba05ebd7e20d94b81fd' });

// API Endpoints
const SUPABASE_URL = 'https://ucrvaqztvfnphhoqcbpo.supabase.co/functions/v1';
const VAULT_API_URL = `${SUPABASE_URL}/FIRECRAWL_DATA`;
const REDEMPTION_API_URL = `${SUPABASE_URL}/REDEMPTION_API`;
const WALLET_DATA_URL = `${SUPABASE_URL}/wallet-data`;
const RECORD_TX_URL = `${SUPABASE_URL}/record-transaction`;

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
    emoji: '📈',
    vaultId: 1
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
    emoji: '🛡️',
    vaultId: 2
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
  const switchChain = useSwitchActiveWalletChain();
  
  // UI State
  const [activePanel, setActivePanel] = useState('overview');
  const [theme, setTheme] = useState('dark');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notification, setNotification] = useState(null);
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false);
  
  // Data State
  const [vaultData, setVaultData] = useState({ arb: null, base: null });
  const [loading, setLoading] = useState(true);
  const [chartRange, setChartRange] = useState('1W');

  // NEW: Wallet data from Supabase
  const [walletSummary, setWalletSummary] = useState(null);
  const [portfolioChart, setPortfolioChart] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [pnlData, setPnlData] = useState(null);

  // User Balances (from blockchain)
  const [userVaultBalances, setUserVaultBalances] = useState({ arb: 0n, base: 0n });
  const [userUsdcBalances, setUserUsdcBalances] = useState({ arb: 0n, base: 0n });
  const [comptrollerAddresses, setComptrollerAddresses] = useState({ arb: null, base: null });

  // Modal State
  const [depositModal, setDepositModal] = useState({ open: false, vault: 'arb' });
  const [redeemModal, setRedeemModal] = useState({ open: false, vault: 'arb' });
  const [depositAmount, setDepositAmount] = useState('');
  const [redeemAmount, setRedeemAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [gasEstimate, setGasEstimate] = useState(null);

  // Redemption Cooldown State (72h)
  const [pendingRedemptions, setPendingRedemptions] = useState({ arb: null, base: null });
  const [countdowns, setCountdowns] = useState({ arb: null, base: null });
  const [cooldownSeconds, setCooldownSeconds] = useState(259200);

  // NEW: Pending transactions tracking
  const [pendingTxs, setPendingTxs] = useState([]);

  // ========== GET CURRENT CHAIN ==========
  const getCurrentChain = () => {
    if (!wallet) return null;
    const chain = wallet.getChain();
    if (chain?.id === arbitrum.id) return 'arb';
    if (chain?.id === base.id) return 'base';
    return null;
  };

  const currentChainKey = getCurrentChain();

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

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';

  const showNotification = (message, type = 'info', txHash = null, network = null) => {
    setNotification({ message, type, txHash, network });
    if (type !== 'error') {
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // ========== PENDING TX MANAGEMENT ==========
  useEffect(() => {
    const stored = localStorage.getItem('g12_pending_txs');
    if (stored) {
      const txs = JSON.parse(stored);
      // Filter out old txs (> 24h)
      const recent = txs.filter(tx => Date.now() - tx.timestamp < 86400000);
      setPendingTxs(recent);
      localStorage.setItem('g12_pending_txs', JSON.stringify(recent));
    }
  }, []);

  const addPendingTx = (txHash, vault, type, amount) => {
    const newTx = {
      txHash,
      vault,
      type,
      amount,
      timestamp: Date.now()
    };
    const updated = [...pendingTxs, newTx];
    setPendingTxs(updated);
    localStorage.setItem('g12_pending_txs', JSON.stringify(updated));
  };

  const removePendingTx = (txHash) => {
    const updated = pendingTxs.filter(tx => tx.txHash !== txHash);
    setPendingTxs(updated);
    localStorage.setItem('g12_pending_txs', JSON.stringify(updated));
  };

  // Check if pending txs appear in transactions list
  useEffect(() => {
    if (transactions.length > 0 && pendingTxs.length > 0) {
      const txHashes = transactions.map(tx => tx.tx_hash.toLowerCase());
      pendingTxs.forEach(ptx => {
        if (txHashes.includes(ptx.txHash.toLowerCase())) {
          removePendingTx(ptx.txHash);
        }
      });
    }
  }, [transactions, pendingTxs]);

  // ========== GAS ESTIMATION ==========
  const estimateDepositGas = useCallback(async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0 || !wallet) {
      setGasEstimate(null);
      return;
    }

    try {
      const vault = ENZYME_VAULTS[depositModal.vault];
      const amount = BigInt(Math.floor(parseFloat(depositAmount) * 1e6));
      const comptrollerAddr = comptrollerAddresses[depositModal.vault];
      
      if (!comptrollerAddr) return;

      const comptrollerContract = getContract({ client, chain: vault.chain, address: comptrollerAddr, abi: COMPTROLLER_ABI });
      const depositTx = prepareContractCall({ contract: comptrollerContract, method: 'buyShares', params: [amount, 1n] });
      
      const gas = await estimateGas({ transaction: depositTx });
      const gasPriceGwei = vault.chain.id === arbitrum.id ? 0.1 : 0.001; // Rough estimates
      const gasCostUsd = Number(gas) * gasPriceGwei * 0.000000001 * 3000; // Assuming $3000 ETH
      
      setGasEstimate(gasCostUsd);
    } catch (err) {
      console.error('Gas estimation failed:', err);
      setGasEstimate(null);
    }
  }, [depositAmount, depositModal.vault, comptrollerAddresses, wallet]);

  useEffect(() => {
    if (depositModal.open) {
      estimateDepositGas();
    }
  }, [depositAmount, depositModal.open, estimateDepositGas]);

  // ========== RECORD TRANSACTION INSTANTLY ==========
  const recordTransaction = async (txData) => {
    try {
      const response = await fetch(RECORD_TX_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(txData)
      });
      const result = await response.json();
      if (!result.ok && !result.duplicate) {
        console.error('Failed to record transaction:', result.error);
      } else {
        console.log('Transaction recorded:', result);
      }
      return result;
    } catch (err) {
      console.error('Record transaction error:', err);
      return { ok: false, error: err.message };
    }
  };

  // ========== THEME EFFECT ==========
  useEffect(() => { 
    document.documentElement.setAttribute('data-theme', theme); 
  }, [theme]);

  // ========== FETCH WALLET DATA FROM SUPABASE ==========
  const fetchWalletData = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${WALLET_DATA_URL}?action=summary&wallet=${address}`);
      const data = await res.json();
      if (data.summary) {
        setWalletSummary(data.summary);
      }
    } catch (err) {
      console.error('Failed to fetch wallet summary:', err);
    }
  }, [address]);

  const fetchTransactions = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${WALLET_DATA_URL}?action=transactions&wallet=${address}&limit=50`);
      const data = await res.json();
      if (data.transactions) {
        setTransactions(data.transactions);
      }
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
    }
  }, [address]);

  const fetchChartData = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${WALLET_DATA_URL}?action=chart&wallet=${address}&range=${chartRange}`);
      const data = await res.json();
      if (data.points) {
        const formatted = data.points.map(p => ({
          date: new Date(p.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          value: p.v
        }));
        setPortfolioChart(formatted);
      }
    } catch (err) {
      console.error('Failed to fetch chart data:', err);
    }
  }, [address, chartRange]);

  const fetchPnlData = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${WALLET_DATA_URL}?action=pnl&wallet=${address}&range=${chartRange}`);
      const data = await res.json();
      if (data.pnl_usd !== undefined) {
        setPnlData(data);
      }
    } catch (err) {
      console.error('Failed to fetch PnL data:', err);
    }
  }, [address, chartRange]);

  useEffect(() => {
    if (address) {
      fetchWalletData();
      fetchTransactions();
      fetchChartData();
      fetchPnlData();
    }
  }, [address, fetchWalletData, fetchTransactions, fetchChartData, fetchPnlData]);

  useEffect(() => {
    fetchChartData();
    fetchPnlData();
  }, [chartRange, fetchChartData, fetchPnlData]);

  // ========== FETCH VAULT DATA ==========
  const fetchVaults = useCallback(async () => {
    setLoading(true);
    try {
      const [arbRes, baseRes] = await Promise.all([
        fetch(`${VAULT_API_URL}?action=get&network=arbitrum`),
        fetch(`${VAULT_API_URL}?action=get&network=base`)
      ]);
      
      const arbData = await arbRes.json();
      const baseData = await baseRes.json();
      
      setVaultData({ arb: arbData.vault || null, base: baseData.vault || null });
    } catch (err) {
      console.error('Failed to fetch vault data:', err);
      showNotification('Failed to load vault data', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVaults();
    const interval = setInterval(fetchVaults, 30000);
    return () => clearInterval(interval);
  }, [fetchVaults]);

  // ========== FETCH USER BALANCES FROM BLOCKCHAIN ==========
  const fetchUserBalances = useCallback(async () => {
    if (!wallet || !address) return;
    try {
      const account = await wallet.getAccount();
      
      for (const [key, vault] of Object.entries(ENZYME_VAULTS)) {
        // Fetch vault shares
        const vaultContract = getContract({ client, chain: vault.chain, address: vault.vaultProxy, abi: VAULT_ABI });
        const sharesBalance = await readContract({ contract: vaultContract, method: 'balanceOf', params: [address] });
        
        // Fetch USDC balance
        const usdcContract = getContract({ client, chain: vault.chain, address: vault.denominationAsset, abi: ERC20_ABI });
        const usdcBalance = await readContract({ contract: usdcContract, method: 'balanceOf', params: [address] });
        
        // Fetch comptroller address
        const comptroller = await readContract({ contract: vaultContract, method: 'getAccessor', params: [] });
        
        setUserVaultBalances(prev => ({ ...prev, [key]: sharesBalance }));
        setUserUsdcBalances(prev => ({ ...prev, [key]: usdcBalance }));
        setComptrollerAddresses(prev => ({ ...prev, [key]: comptroller }));
      }
    } catch (err) {
      console.error('Failed to fetch user balances:', err);
    }
  }, [wallet, address]);

  useEffect(() => {
    fetchUserBalances();
    const interval = setInterval(fetchUserBalances, 15000);
    return () => clearInterval(interval);
  }, [fetchUserBalances]);

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
      
      // Check and switch network if needed
      const currentChain = wallet.getChain();
      if (currentChain?.id !== vault.chain.id) {
        showNotification(`Switching to ${vault.network}...`, 'info');
        await switchChain(vault.chain);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for network switch
      }
      
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

      showNotification('Approving USDC...', 'info');
      const usdcContract = getContract({ client, chain: vault.chain, address: vault.denominationAsset, abi: ERC20_ABI });
      const approveTx = prepareContractCall({ contract: usdcContract, method: 'approve', params: [comptrollerAddr, amount] });
      const approveResult = await sendTransaction({ transaction: approveTx, account });
      await waitForReceipt({ client, chain: vault.chain, transactionHash: approveResult.transactionHash });
      
      showNotification('Depositing...', 'info');
      const comptrollerContract = getContract({ client, chain: vault.chain, address: comptrollerAddr, abi: COMPTROLLER_ABI });
      const depositTx = prepareContractCall({ contract: comptrollerContract, method: 'buyShares', params: [amount, 1n] });
      const depositResult = await sendTransaction({ transaction: depositTx, account });
      const receipt = await waitForReceipt({ client, chain: vault.chain, transactionHash: depositResult.transactionHash });

      // Add to pending txs
      addPendingTx(depositResult.transactionHash, vault.name, 'DEPOSIT', parseFloat(depositAmount));

      // RECORD TRANSACTION INSTANTLY
      const depositAmountNum = parseFloat(depositAmount);
      const sharePrice = vaultData[vaultKey]?.share_price || 1;
      const estimatedShares = depositAmountNum / sharePrice;
      
      await recordTransaction({
        wallet_address: address,
        vault_id: vault.vaultId,
        network: vault.network.toLowerCase(),
        direction: 'DEPOSIT',
        amount_usd: depositAmountNum,
        tx_hash: depositResult.transactionHash,
        block_number: receipt.blockNumber ? Number(receipt.blockNumber) : null,
        shares_amount: estimatedShares
      });

      showNotification(`Successfully deposited ${depositAmount} USDC!`, 'success', depositResult.transactionHash, vault.network.toLowerCase());
      setDepositModal({ open: false, vault: 'arb' });
      setDepositAmount('');
      setGasEstimate(null);
      
      // Refresh data immediately
      fetchUserBalances();
      fetchWalletData();
      fetchChartData();
    } catch (err) {
      console.error('Deposit error:', err);
      showNotification(err.message || 'Deposit failed', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // ========== REDEMPTION FUNCTIONS ==========
  const fetchPendingRedemptions = useCallback(async () => {
    if (!address) return;
    try {
      for (const [key, vault] of Object.entries(ENZYME_VAULTS)) {
        const res = await fetch(`${REDEMPTION_API_URL}?action=pending&wallet=${address}&vault=${vault.vaultId}`);
        const data = await res.json();
        if (data.redemptions && data.redemptions.length > 0) {
          setPendingRedemptions(prev => ({ ...prev, [key]: data.redemptions[0] }));
        } else {
          setPendingRedemptions(prev => ({ ...prev, [key]: null }));
        }
      }
    } catch (err) {
      console.error('Failed to fetch pending redemptions:', err);
    }
  }, [address]);

  useEffect(() => {
    fetchPendingRedemptions();
    const interval = setInterval(fetchPendingRedemptions, 10000);
    return () => clearInterval(interval);
  }, [fetchPendingRedemptions]);

  useEffect(() => {
    const interval = setInterval(() => {
      const newCountdowns = {};
      for (const [key, redemption] of Object.entries(pendingRedemptions)) {
        if (redemption) {
          const unlockTime = new Date(redemption.unlock_at).getTime();
          const remaining = unlockTime - Date.now();
          newCountdowns[key] = remaining;
        } else {
          newCountdowns[key] = null;
        }
      }
      setCountdowns(newCountdowns);
    }, 1000);
    return () => clearInterval(interval);
  }, [pendingRedemptions]);

  const hasPendingRedemption = (vaultKey) => !!pendingRedemptions[vaultKey];
  const isRedemptionReady = (vaultKey) => {
    if (!pendingRedemptions[vaultKey]) return false;
    return countdowns[vaultKey] !== null && countdowns[vaultKey] <= 0;
  };

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

      const payload = {
        wallet_address: address,
        vault: vault.vaultId,
        shares_amount: sharesAmount,
        estimated_usdc_value: estimatedUsdc
      };

      const res = await fetch(`${REDEMPTION_API_URL}?action=create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      
      if (data.ok) {
        showNotification(`Redemption request submitted! Wait ${formatCooldownDisplay()} to complete.`, 'success');
        fetchPendingRedemptions();
        setRedeemModal({ open: false, vault: 'arb' });
        setRedeemAmount('');
      } else {
        showNotification(data.error || 'Failed to create redemption request', 'error');
      }
    } catch (err) {
      console.error('Redemption request error:', err);
      showNotification(err.message || 'Failed to submit request', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const cancelRedemption = async (vaultKey) => {
    const redemption = pendingRedemptions[vaultKey];
    if (!redemption) return;

    try {
      const res = await fetch(`${REDEMPTION_API_URL}?action=update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: redemption.id, status: 'cancelled' })
      });
      
      const data = await res.json();
      if (data.ok) {
        showNotification('Redemption request cancelled', 'info');
        fetchPendingRedemptions();
        setRedeemModal({ open: false, vault: 'arb' });
      }
    } catch (err) {
      console.error('Cancel redemption error:', err);
      showNotification('Failed to cancel request', 'error');
    }
  };

  const executeRedemption = async () => {
    const vaultKey = redeemModal.vault;
    const vault = ENZYME_VAULTS[vaultKey];
    const redemption = pendingRedemptions[vaultKey];
    
    if (!redemption || !isRedemptionReady(vaultKey)) {
      showNotification('Redemption not ready yet', 'error');
      return;
    }

    setIsProcessing(true);
    try {
      const account = await wallet.getAccount();
      
      // Check and switch network if needed
      const currentChain = wallet.getChain();
      if (currentChain?.id !== vault.chain.id) {
        showNotification(`Switching to ${vault.network}...`, 'info');
        await switchChain(vault.chain);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const sharesAmount = BigInt(Math.floor(redemption.shares_amount * 1e18));
      const comptrollerAddr = comptrollerAddresses[vaultKey];

      if (!comptrollerAddr) {
        showNotification('Could not find vault comptroller', 'error');
        setIsProcessing(false);
        return;
      }

      showNotification('Processing withdrawal...', 'info');
      const comptrollerContract = getContract({ client, chain: vault.chain, address: comptrollerAddr, abi: COMPTROLLER_ABI });
      const redeemTx = prepareContractCall({
        contract: comptrollerContract,
        method: 'redeemSharesForSpecificAssets',
        params: [address, sharesAmount, [vault.denominationAsset], [10000n]]
      });

      const redeemResult = await sendTransaction({ transaction: redeemTx, account });
      const receipt = await waitForReceipt({ client, chain: vault.chain, transactionHash: redeemResult.transactionHash });

      // Add to pending txs
      addPendingTx(redeemResult.transactionHash, vault.name, 'WITHDRAW', redemption.estimated_usdc_value);

      // Update redemption status
      await fetch(`${REDEMPTION_API_URL}?action=update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: redemption.id, 
          status: 'completed',
          tx_hash: redeemResult.transactionHash
        })
      });

      // Record transaction
      await recordTransaction({
        wallet_address: address,
        vault_id: vault.vaultId,
        network: vault.network.toLowerCase(),
        direction: 'WITHDRAW',
        amount_usd: redemption.estimated_usdc_value,
        tx_hash: redeemResult.transactionHash,
        block_number: receipt.blockNumber ? Number(receipt.blockNumber) : null,
        shares_amount: redemption.shares_amount
      });

      showNotification('Withdrawal successful!', 'success', redeemResult.transactionHash, vault.network.toLowerCase());
      fetchPendingRedemptions();
      setRedeemModal({ open: false, vault: 'arb' });
      
      // Refresh balances
      fetchUserBalances();
      fetchWalletData();
      fetchChartData();
    } catch (err) {
      console.error('Execute redemption error:', err);
      showNotification(err.message || 'Withdrawal failed', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLogout = () => {
    disconnect();
  };

  // ========== COMPUTED VALUES ==========
  const totalBalance = walletSummary?.current_value || 0;
  const walletUsdc = Number(userUsdcBalances.arb) / 1e6 + Number(userUsdcBalances.base) / 1e6;
  const pnlUsd = pnlData?.pnl_usd || 0;
  const pnlPercent = pnlData?.pnl_percent || 0;

  // ========== LOADING SKELETON COMPONENT ==========
  const Skeleton = ({ width = '100%', height = '20px' }) => (
    <div style={{ 
      width, 
      height, 
      background: 'linear-gradient(90deg, var(--bg-card) 0%, rgba(255,255,255,0.05) 50%, var(--bg-card) 100%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.5s infinite',
      borderRadius: '4px'
    }} />
  );

  return (
    <div className="dashboard-layout" data-theme={theme}>
      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-container">
            <img src="/logo_g12.svg" alt="G12 Labs" />
            <span className="logo-text">G12 LABS</span>
          </div>
        </div>

        <nav className="nav-section">
          <div className="nav-label">Main Menu</div>
          <div className={`nav-item ${activePanel === 'overview' ? 'active' : ''}`} onClick={() => { setActivePanel('overview'); setMobileMenuOpen(false); }}>
            <i className="ph ph-squares-four"></i>
            <span>Dashboard</span>
          </div>
          <div className={`nav-item ${activePanel === 'buy-sell' ? 'active' : ''}`} onClick={() => { setActivePanel('buy-sell'); setMobileMenuOpen(false); }}>
            <i className="ph ph-arrows-left-right"></i>
            <span>Buy / Sell</span>
          </div>
          <div className={`nav-item ${activePanel === 'transactions' ? 'active' : ''}`} onClick={() => { setActivePanel('transactions'); setMobileMenuOpen(false); }}>
            <i className="ph ph-list-dashes"></i>
            <span>Transactions</span>
          </div>
        </nav>

        <nav className="nav-section">
          <div className="nav-label">Account</div>
          <div className={`nav-item ${activePanel === 'settings' ? 'active' : ''}`} onClick={() => { setActivePanel('settings'); setMobileMenuOpen(false); }}>
            <i className="ph ph-gear"></i>
            <span>Settings</span>
          </div>
        </nav>

        <div className="sidebar-footer">
          <button className="disconnect-btn" onClick={handleLogout}>
            <i className="ph ph-sign-out"></i>
            <span>Disconnect</span>
          </button>
        </div>
      </aside>

      {mobileMenuOpen && <div className="sidebar-overlay" onClick={() => setMobileMenuOpen(false)} />}

      {/* Main Content */}
      <main className="main-content">
        {/* Topbar */}
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              <i className="ph ph-list"></i>
            </button>
            <div className="breadcrumbs">
              Dashboard / 
              <span>
                {activePanel === 'overview' ? 'Overview' : activePanel === 'buy-sell' ? 'Buy / Sell' : activePanel === 'transactions' ? 'Transactions' : 'Settings'}
              </span>
            </div>
          </div>

          <div className="topbar-right">
            {/* Network Indicator + Switcher */}
            <div className="network-dropdown" style={{ position: 'relative' }}>
              <button 
                className="network-btn"
                onClick={() => setNetworkDropdownOpen(!networkDropdownOpen)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 12px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: '500',
                  color: 'var(--text-main)'
                }}
              >
                <div style={{ 
                  width: '8px', 
                  height: '8px', 
                  borderRadius: '50%', 
                  background: currentChainKey === 'arb' ? '#E85A04' : currentChainKey === 'base' ? '#0052FF' : '#888'
                }} />
                {currentChainKey === 'arb' ? 'Arbitrum' : currentChainKey === 'base' ? 'Base' : 'Not Connected'}
                <i className="ph ph-caret-down"></i>
              </button>
              
              {networkDropdownOpen && (
                <>
                  <div 
                    style={{ position: 'fixed', inset: 0, zIndex: 49 }} 
                    onClick={() => setNetworkDropdownOpen(false)} 
                  />
                  <div 
                    className="network-dropdown-menu"
                    style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: '8px',
                      background: 'var(--bg-sidebar)',
                      border: '1px solid var(--border)',
                      borderRadius: '12px',
                      padding: '8px',
                      minWidth: '160px',
                      zIndex: 50,
                      boxShadow: 'var(--shadow-card)'
                    }}
                  >
                    <button
                      onClick={async () => {
                        await switchChain(arbitrum);
                        setNetworkDropdownOpen(false);
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 12px',
                        background: currentChainKey === 'arb' ? 'var(--bg-card)' : 'transparent',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        color: 'var(--text-main)',
                        textAlign: 'left',
                        transition: '0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-card)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = currentChainKey === 'arb' ? 'var(--bg-card)' : 'transparent'}
                    >
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#E85A04' }} />
                      Arbitrum
                    </button>
                    <button
                      onClick={async () => {
                        await switchChain(base);
                        setNetworkDropdownOpen(false);
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 12px',
                        background: currentChainKey === 'base' ? 'var(--bg-card)' : 'transparent',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        color: 'var(--text-main)',
                        textAlign: 'left',
                        transition: '0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-card)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = currentChainKey === 'base' ? 'var(--bg-card)' : 'transparent'}
                    >
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#0052FF' }} />
                      Base
                    </button>
                  </div>
                </>
              )}
            </div>

            <button className="refresh-btn" onClick={fetchVaults}>
              <i className="ph ph-arrows-clockwise"></i>
            </button>

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
            {notification.txHash && notification.network && (
              <a 
                href={`https://${notification.network === 'base' ? 'basescan.org' : 'arbiscan.io'}/tx/${notification.txHash}`}
                target="_blank"
                rel="noreferrer"
                style={{ marginLeft: '8px', color: 'inherit', textDecoration: 'underline' }}
              >
                View TX
              </a>
            )}
          </div>
        )}

        {/* Pending Transactions Banner */}
        {pendingTxs.length > 0 && (
          <div style={{
            margin: '20px 40px 0',
            padding: '16px',
            background: 'var(--warning-bg)',
            border: '1px solid var(--warning)',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            color: 'var(--warning)'
          }}>
            <i className="ph ph-clock" style={{ fontSize: '20px' }}></i>
            <div style={{ flex: 1 }}>
              <strong style={{ color: 'var(--text-main)' }}>Transactions Pending</strong>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {pendingTxs.length} transaction{pendingTxs.length > 1 ? 's' : ''} being indexed. This may take up to 10 minutes.
              </div>
            </div>
            <button 
              onClick={() => setPendingTxs([])}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px'
              }}
            >
              <i className="ph ph-x"></i>
            </button>
          </div>
        )}

        <div className="content-wrapper">
          {/* ========== OVERVIEW PANEL ========== */}
          {activePanel === 'overview' && (
            <>
              <div className="row-top">
                {/* Portfolio Card */}
                <div className="glass-card portfolio-card">
                  {loading ? (
                    <div style={{ padding: '20px' }}>
                      <Skeleton width="120px" height="14px" />
                      <div style={{ marginTop: '12px' }}><Skeleton width="180px" height="32px" /></div>
                      <div style={{ marginTop: '8px' }}><Skeleton width="140px" height="16px" /></div>
                      <div style={{ marginTop: '40px', height: '180px', background: 'var(--bg-card)' }} />
                    </div>
                  ) : (
                    <>
                      <div className="p-header">
                        <h2>Total Portfolio</h2>
                        <div className="p-balance mono">{fmtUsd(totalBalance)}</div>
                        <div className={`p-change ${pnlUsd >= 0 ? 'positive' : 'negative'}`}>
                          <i className={`ph ${pnlUsd >= 0 ? 'ph-trend-up' : 'ph-trend-down'}`}></i>
                          {fmtUsd(Math.abs(pnlUsd))} ({fmtPercent(pnlPercent)})
                          <span className="pnl-period">({chartRange})</span>
                        </div>
                      </div>

                      {/* Time Range Selector */}
                      <div className="chart-range-btns top-range">
                        {['1D', '1W', '1M', 'ALL'].map(r => (
                          <button 
                            key={r} 
                            className={`range-btn ${chartRange === r ? 'active' : ''}`} 
                            onClick={() => setChartRange(r)}
                          >
                            {r}
                          </button>
                        ))}
                      </div>

                      {/* Chart */}
                      <div style={{ width: '100%', height: '180px', marginTop: '16px' }}>
                        {portfolioChart.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={portfolioChart}>
                              <defs>
                                <linearGradient id="colorPortfolio" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#E85A04" stopOpacity={0.3} />
                                  <stop offset="95%" stopColor="#E85A04" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <XAxis dataKey="date" hide />
                              <YAxis hide domain={['auto', 'auto']} />
                              <Tooltip
                                contentStyle={{ backgroundColor: 'var(--bg-root)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-main)' }}
                                itemStyle={{ color: 'var(--text-main)' }}
                                formatter={(value) => [fmtUsd(value), 'Portfolio Value']}
                                labelFormatter={(label) => label}
                              />
                              <Area
                                type="monotone"
                                dataKey="value"
                                stroke="#E85A04"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorPortfolio)"
                                isAnimationActive={false}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        ) : (
                          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                            <i className="ph ph-chart-line" style={{ marginRight: '8px', fontSize: '18px' }}></i>
                            Your portfolio history will appear here after your first deposit
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Actions Card */}
                <div className="glass-card actions-card">
                  <div className="available-row">
                    <div>
                      <div className="av-label">Wallet Balance</div>
                      <div className="av-val mono" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <img src="/usd-coin-usdc-logo.png" width="24" height="24" alt="USDC" />
                        {loading ? <Skeleton width="100px" height="24px" /> : fmtUsd(walletUsdc)}
                      </div>
                    </div>
                  </div>

                  <div className="quick-actions">
                    <button className="action-btn primary" onClick={() => setDepositModal({ open: true, vault: currentChainKey || 'arb' })}>
                      <i className="ph ph-arrow-down"></i>
                      <span>Deposit USDC</span>
                    </button>
                    <button className="action-btn" onClick={() => setRedeemModal({ open: true, vault: currentChainKey || 'arb' })}>
                      <i className="ph ph-arrow-up"></i>
                      <span>Withdraw</span>
                    </button>
                  </div>

                  <div className="recent-activity">
                    <div className="ra-header">
                      <i className="ph ph-clock-counter-clockwise"></i>
                      <span>Recent Activity</span>
                    </div>
                    {loading ? (
                      <>
                        <Skeleton width="100%" height="60px" />
                        <Skeleton width="100%" height="60px" />
                      </>
                    ) : transactions.slice(0, 3).length > 0 ? (
                      transactions.slice(0, 3).map((tx, i) => (
                        <div key={i} className="activity-item">
                          <div className={`ai-icon ${tx.type === 'DEPOSIT' ? 'deposit' : 'withdraw'}`}>
                            <i className={`ph ${tx.type === 'DEPOSIT' ? 'ph-arrow-down' : 'ph-arrow-up'}`}></i>
                          </div>
                          <div className="ai-details">
                            <div className="ai-title">{tx.type === 'DEPOSIT' ? 'Deposit' : 'Withdraw'}</div>
                            <div className="ai-subtitle">{tx.vault} • {formatDate(tx.timestamp)}</div>
                          </div>
                          <div className={`ai-amount mono ${tx.type === 'DEPOSIT' ? 'positive' : 'negative'}`}>
                            {tx.type === 'DEPOSIT' ? '+' : '-'}{fmtUsd(tx.amount_usd)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                        <i className="ph ph-scroll" style={{ fontSize: '24px', display: 'block', marginBottom: '8px', opacity: 0.5 }}></i>
                        No transactions yet
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Vaults Row */}
              <div className="row-bottom">
                {Object.entries(ENZYME_VAULTS).map(([key, vault]) => {
                  const data = vaultData[key];
                  const userShares = Number(userVaultBalances[key]) / 1e18;
                  const userValue = userShares * (data?.share_price || 0);
                  const pending = pendingRedemptions[key];

                  return (
                    <div key={key} className="glass-card vault-card">
                      <div className="vc-header">
                        <div className="vc-icon-wrapper">
                          <img src={vault.icon} alt={vault.name} className="vc-icon" />
                        </div>
                        <div className="vc-title">
                          <h3>{vault.name}</h3>
                          <span className="vc-network">{vault.network}</span>
                        </div>
                      </div>

                      {loading ? (
                        <div style={{ padding: '20px 0' }}>
                          <Skeleton width="100%" height="60px" />
                          <div style={{ marginTop: '16px' }}><Skeleton width="100%" height="40px" /></div>
                        </div>
                      ) : (
                        <>
                          <div className="vc-stats">
                            <div className="vc-stat">
                              <span className="label">Share Price</span>
                              <span className="value mono">{fmtSharePrice(data?.share_price)}</span>
                            </div>
                            <div className="vc-stat">
                              <span className="label">Net APY</span>
                              <span className={`value apy-badge ${(data?.monthly_return || 0) >= 0 ? 'positive' : 'negative'}`}>
                                {fmtPercent(data?.monthly_return)}
                              </span>
                            </div>
                            <div className="vc-stat">
                              <span className="label">Your Balance</span>
                              <span className="value mono">{fmtUsd(userValue)}</span>
                            </div>
                            <div className="vc-stat">
                              <span className="label">Your Shares</span>
                              <span className="value mono">{userShares.toFixed(4)}</span>
                            </div>
                          </div>

                          {pending && (
                            <div className={`pending-banner ${isRedemptionReady(key) ? 'ready' : 'waiting'}`}>
                              <i className="ph ph-clock"></i>
                              <span>
                                {isRedemptionReady(key) 
                                  ? 'Redemption Ready!' 
                                  : `Unlocks in ${formatCountdown(countdowns[key])}`
                                }
                              </span>
                            </div>
                          )}

                          <div className="vc-actions">
                            <button className="btn btn-primary" onClick={() => setDepositModal({ open: true, vault: key })}>
                              <i className="ph ph-plus"></i> Deposit
                            </button>
                            <button className="btn btn-secondary" onClick={() => setRedeemModal({ open: true, vault: key })}>
                              <i className="ph ph-minus"></i> Redeem
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ========== BUY/SELL PANEL ========== */}
          {activePanel === 'buy-sell' && (
            <div className="vault-grid">
              {Object.entries(ENZYME_VAULTS).map(([key, vault]) => {
                const data = vaultData[key];
                const userShares = Number(userVaultBalances[key]) / 1e18;
                const userValue = userShares * (data?.share_price || 0);
                const pending = pendingRedemptions[key];

                return (
                  <div key={key} className="glass-card vault-card-large">
                    <div className="vc-header">
                      <div className="vc-icon-wrapper">
                        <img src={vault.icon} alt={vault.name} className="vc-icon" />
                      </div>
                      <div className="vc-title">
                        <h3>{vault.name}</h3>
                        <span className="vc-network">{vault.network}</span>
                      </div>
                      <a href={vault.enzymeUrl} target="_blank" rel="noreferrer" className="enzyme-link">
                        <i className="ph ph-arrow-square-out"></i>
                      </a>
                    </div>

                    <div className="vc-stats-grid">
                      <div className="vc-stat">
                        <span className="label">Share Price</span>
                        <span className="value mono">{fmtSharePrice(data?.share_price)}</span>
                      </div>
                      <div className="vc-stat">
                        <span className="label">AUM</span>
                        <span className="value mono">{fmtUsd(data?.aum)}</span>
                      </div>
                      <div className="vc-stat">
                        <span className="label">Net APY</span>
                        <span className={`value apy-badge ${(data?.monthly_return || 0) >= 0 ? 'positive' : 'negative'}`}>
                          {fmtPercent(data?.monthly_return)}
                        </span>
                      </div>
                      <div className="vc-stat">
                        <span className="label">Depositors</span>
                        <span className="value">{data?.depositors || '—'}</span>
                      </div>
                      <div className="vc-stat">
                        <span className="label">Your Balance</span>
                        <span className="value mono">{fmtUsd(userValue)}</span>
                      </div>
                      <div className="vc-stat">
                        <span className="label">Your Shares</span>
                        <span className="value mono">{userShares.toFixed(6)}</span>
                      </div>
                    </div>

                    {pending && (
                      <div className={`pending-banner ${isRedemptionReady(key) ? 'ready' : 'waiting'}`}>
                        <i className="ph ph-clock"></i>
                        <span>
                          {isRedemptionReady(key) 
                            ? 'Redemption Ready - Click Redeem to complete' 
                            : `Redemption unlocks in ${formatCountdown(countdowns[key])}`
                          }
                        </span>
                      </div>
                    )}

                    <div className="vc-actions">
                      <button className="btn btn-primary btn-lg" onClick={() => setDepositModal({ open: true, vault: key })}>
                        <i className="ph ph-arrow-down"></i> Deposit USDC
                      </button>
                      <button className="btn btn-secondary btn-lg" onClick={() => setRedeemModal({ open: true, vault: key })}>
                        <i className="ph ph-arrow-up"></i> Redeem Shares
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ========== TRANSACTIONS PANEL ========== */}
          {activePanel === 'transactions' && (
            <div className="glass-card" style={{ padding: 0, overflowX: 'auto' }}>
              <table className="full-tx-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Vault</th>
                    <th>Amount</th>
                    <th>Date</th>
                    <th>Tx Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length > 0 ? (
                    transactions.map((tx, i) => (
                      <tr key={i}>
                        <td>
                          <span className={`tx-badge ${tx.type === 'DEPOSIT' ? 'deposit' : 'withdraw'}`}>
                            <i className={`ph ${tx.type === 'DEPOSIT' ? 'ph-arrow-down' : 'ph-arrow-up'}`}></i>
                            {tx.type === 'DEPOSIT' ? 'Deposit' : 'Withdraw'}
                          </span>
                        </td>
                        <td>{tx.vault}</td>
                        <td className={`mono ${tx.type === 'DEPOSIT' ? 'positive' : 'negative'}`}>
                          {tx.type === 'DEPOSIT' ? '+' : '-'}{fmtUsd(tx.amount_usd)}
                        </td>
                        <td>{formatDate(tx.timestamp)}</td>
                        <td>
                          <a 
                            href={`https://${tx.network === 'base' ? 'basescan.org' : 'arbiscan.io'}/tx/${tx.tx_hash}`} 
                            target="_blank" 
                            rel="noreferrer"
                            className="tx-link"
                          >
                            {tx.tx_hash.slice(0, 8)}...{tx.tx_hash.slice(-6)}
                            <i className="ph ph-arrow-square-out"></i>
                          </a>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5" style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <i className="ph ph-scroll" style={{ fontSize: '32px', marginBottom: '12px', display: 'block', opacity: 0.5 }}></i>
                        No transactions yet. Make your first deposit to get started!
                      </td>
                    </tr>
                  )}
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
                    <button className="copy-btn" onClick={() => { navigator.clipboard.writeText(address); showNotification('Address copied!', 'success'); }}>
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
                {walletSummary && (
                  <>
                    <div className="setting-item">
                      <span className="setting-label">Total Deposited (All Time)</span>
                      <span className="setting-value">{fmtUsd(walletSummary.total_deposited)}</span>
                    </div>
                    <div className="setting-item">
                      <span className="setting-label">Total Withdrawn (All Time)</span>
                      <span className="setting-value">{fmtUsd(walletSummary.total_withdrawn)}</span>
                    </div>
                    <div className="setting-item">
                      <span className="setting-label">Net Invested</span>
                      <span className="setting-value mono" style={{ fontWeight: 600, color: 'var(--magma-core)' }}>
                        {fmtUsd(walletSummary.net_invested)}
                      </span>
                    </div>
                    <div className="setting-item">
                      <span className="setting-label">All-Time P&L</span>
                      <span className={`setting-value ${walletSummary.pnl_usd >= 0 ? 'positive' : 'negative'}`}>
                        {fmtUsd(walletSummary.pnl_usd)} ({fmtPercent(walletSummary.pnl_percent)})
                      </span>
                    </div>
                  </>
                )}
                <button className="btn btn-secondary btn-danger" onClick={handleLogout} style={{ marginTop: '16px' }}>
                  <i className="ph ph-sign-out"></i> Disconnect Wallet
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ========== DEPOSIT MODAL ========== */}
      {depositModal.open && (
        <div className="modal-overlay" onClick={() => { setDepositModal({ open: false, vault: 'arb' }); setGasEstimate(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-icon" style={{ background: '#10B98120', color: '#10B981' }}>
                <i className="ph ph-arrow-down"></i>
              </div>
              <div>
                <div className="modal-title">Deposit USDC</div>
                <div className="modal-subtitle">Add funds to start earning yield</div>
              </div>
              <button className="close-btn" onClick={() => { setDepositModal({ open: false, vault: 'arb' }); setGasEstimate(null); }}>
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
                  {gasEstimate && (
                    <span style={{ marginLeft: '12px', color: 'var(--text-muted)' }}>
                      • Est. gas: ~${gasEstimate.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>

              {depositModal.vault !== currentChainKey && currentChainKey && (
                <div className="info-callout warning">
                  <i className="ph ph-warning"></i>
                  <div>
                    <strong>Network Switch Required</strong>
                    <p>You'll be prompted to switch from {currentChainKey === 'arb' ? 'Arbitrum' : 'Base'} to {ENZYME_VAULTS[depositModal.vault].network}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => { setDepositModal({ open: false, vault: 'arb' }); setGasEstimate(null); }}>Cancel</button>
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
                        <div style={{ 
                          width: '100%', 
                          height: '4px', 
                          background: 'var(--bg-root)', 
                          borderRadius: '2px', 
                          overflow: 'hidden',
                          marginTop: '8px'
                        }}>
                          <div style={{
                            width: `${Math.max(0, Math.min(100, ((cooldownSeconds * 1000 - (countdowns[redeemModal.vault] || 0)) / (cooldownSeconds * 1000)) * 100))}%`,
                            height: '100%',
                            background: 'var(--warning)',
                            transition: 'width 1s linear'
                          }} />
                        </div>
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

      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .spinning {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default Dashboard;