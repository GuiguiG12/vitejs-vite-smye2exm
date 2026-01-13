import { useActiveAccount } from 'thirdweb/react';
import LoginView from './components/LoginView';
import Dashboard from './components/Dashboard';

function App() {
  const account = useActiveAccount();

  return (
    <div className="app">
      {account ? <Dashboard address={account.address} /> : <LoginView />}
    </div>
  );
}

export default App;
