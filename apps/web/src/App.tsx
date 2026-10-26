import { useState, useEffect } from 'react';
import {
  api,
  type User,
  type ServerDetail,
  type CapacityStatus,
  type ApiError,
} from './api/client';
import { ToastProvider, useToast } from './components/Toast';
import { AuthModal } from './components/AuthModal';
import { Dashboard } from './components/Dashboard';
import { DeployWizard } from './components/DeployWizard';
import { ServerView } from './components/ServerView';
import { AdminView } from './components/AdminView';

export function AppContent() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [servers, setServers] = useState<ServerDetail[]>([]);
  const [capacity, setCapacity] = useState<CapacityStatus | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [showDeployWizard, setShowDeployWizard] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [loading, setLoading] = useState(true);

  const { addToast } = useToast();

  const loadData = async () => {
    try {
      const [serversData, capacityData] = await Promise.all([
        api.listServers(),
        api.getCapacity(),
      ]);
      setServers(serversData);
      setCapacity(capacityData);
    } catch {
      // not logged in or error
    }
  };

  useEffect(() => {
    // Check authentication and setup status
    api
      .getMe()
      .then((user) => {
        setCurrentUser(user);
        loadData();
      })
      .catch(() => {
        // Check if first-run setup is required
        api
          .getSetupStatus()
          .then((res) => setNeedsSetup(res.needsSetup))
          .catch(() => setNeedsSetup(false));
      })
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    try {
      await api.logout();
      setCurrentUser(null);
      setSelectedServerId(null);
      setShowAdmin(false);
      addToast({ type: 'info', title: 'Signed out.' });
    } catch {
      setCurrentUser(null);
    }
  };

  const handleQuickPower = async (id: string, action: 'start' | 'stop') => {
    try {
      if (action === 'start') await api.startServer(id);
      if (action === 'stop') await api.stopServer(id);
      addToast({ type: 'success', title: `Server ${action} initiated.` });
      await loadData();
    } catch (err) {
      const error = err as ApiError;
      addToast({ type: 'error', title: `Failed to ${action} server`, message: error.message });
    }
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.classList.toggle('light', nextTheme === 'light');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center mx-auto mb-3 animate-pulse">
            <span className="font-bold text-primary">V</span>
          </div>
          <p className="text-xs text-muted-foreground font-mono">Loading VaultRealm...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full min-h-screen flex flex-col bg-background text-foreground ${theme}`}>
      {/* ── Navigation Bar ────────────────────────────────────────────────── */}
      <header className="w-full border-b border-border bg-card/80 backdrop-blur-lg sticky top-0 z-40 shadow-sm">
        <div className="w-full mx-auto max-w-[1600px] px-6 sm:px-8 lg:px-10 py-4 flex items-center justify-between gap-4">
          <div
            onClick={() => {
              setSelectedServerId(null);
              setShowAdmin(false);
            }}
            className="flex items-center gap-3 cursor-pointer group select-none"
          >
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-md glow-primary group-hover:scale-105 transition-transform">
              <span className="text-sm font-black text-white">V</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-black gradient-text tracking-tight">VaultRealm</span>
                <span className="badge badge-primary text-[10px] py-0.5 px-2">v0.5</span>
              </div>
              <span className="text-[11px] text-muted-foreground block font-mono">
                Game Server Panel
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="btn btn-secondary btn-sm p-2 text-xs"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>

            {currentUser ? (
              <div className="flex items-center gap-3">
                {currentUser.role === 'admin' && (
                  <button
                    onClick={() => {
                      setShowAdmin(true);
                      setSelectedServerId(null);
                    }}
                    className={`btn btn-sm ${
                      showAdmin
                        ? 'btn-primary'
                        : 'btn-secondary text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    ⚙️ Admin Control
                  </button>
                )}

                <div className="flex items-center gap-3 pl-3 border-l border-border">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary">
                      {currentUser.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-left hidden sm:block">
                      <span className="text-xs font-bold text-foreground block leading-none mb-0.5">
                        {currentUser.username}
                      </span>
                      <span className="badge badge-neutral text-[9px] py-0 px-1.5 uppercase font-mono">
                        {currentUser.role}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="btn btn-secondary btn-sm p-1.5 text-muted-foreground hover:text-destructive"
                    title="Sign Out"
                  >
                    🚪
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* ── Main Content Area ─────────────────────────────────────────────── */}
      <main className="flex-1 w-full mx-auto max-w-[1600px] px-6 sm:px-8 lg:px-10 py-6 sm:py-8">
        {!currentUser ? (
          <AuthModal
            needsSetup={needsSetup ?? false}
            onSuccess={(user) => {
              setCurrentUser(user);
              loadData();
            }}
          />
        ) : showAdmin ? (
          <AdminView onBack={() => setShowAdmin(false)} />
        ) : selectedServerId ? (
          <ServerView
            serverId={selectedServerId}
            onBack={() => setSelectedServerId(null)}
            onDelete={() => {
              setSelectedServerId(null);
              loadData();
            }}
          />
        ) : (
          <Dashboard
            servers={servers}
            capacity={capacity}
            onSelectServer={(id) => setSelectedServerId(id)}
            onOpenDeploy={() => setShowDeployWizard(true)}
            onQuickPower={handleQuickPower}
          />
        )}
      </main>

      {/* ── Deploy Wizard Modal ──────────────────────────────────────────── */}
      {showDeployWizard && (
        <DeployWizard
          onClose={() => setShowDeployWizard(false)}
          onSuccess={(newServerId) => {
            setShowDeployWizard(false);
            setSelectedServerId(newServerId);
            loadData();
          }}
        />
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="w-full border-t border-border py-4 text-center text-xs text-muted-foreground">
        VaultRealm Self-Hosted Control Panel • Lightweight & Autonomous
      </footer>
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
export default App;
