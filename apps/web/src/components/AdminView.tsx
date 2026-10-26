import { useState, useEffect } from 'react';
import { api, type CapacityStatus, type ApiError } from '../api/client';
import { useToast } from './Toast';

interface AdminViewProps {
  onBack: () => void;
}

export function AdminView({ onBack }: AdminViewProps) {
  const [invites, setInvites] = useState<Array<{ id: string; code: string; uses: number; maxUses: number; createdAt: string }>>([]);
  const [capacity, setCapacity] = useState<CapacityStatus | null>(null);
  const [maxUses, setMaxUses] = useState(10);
  const [creating, setCreating] = useState(false);

  const { addToast } = useToast();

  const loadData = async () => {
    try {
      const [invitesData, capacityData] = await Promise.all([
        api.listInvites(),
        api.getCapacity(),
      ]);
      setInvites(invitesData);
      setCapacity(capacityData);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateInvite = async () => {
    setCreating(true);
    try {
      const inv = await api.createInvite(maxUses);
      addToast({ type: 'success', title: `Invite created: ${inv.code}` });
      await loadData();
    } catch (err) {
      const error = err as ApiError;
      addToast({ type: 'error', title: 'Could not create invite', message: error.message });
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteInvite = async (id: string) => {
    try {
      await api.deleteInvite(id);
      addToast({ type: 'success', title: 'Invite code revoked.' });
      setInvites((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      const error = err as ApiError;
      addToast({ type: 'error', title: 'Could not delete invite', message: error.message });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="btn btn-secondary btn-sm"
          >
            ← Back
          </button>
          <div>
            <h1 className="text-xl font-bold text-foreground">Admin Control Plane</h1>
            <p className="text-xs text-muted-foreground">Manage registration invites and host capacity</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Create & Manage Invites */}
        <div className="card p-6 border border-border/80 space-y-4">
          <h2 className="text-base font-bold text-foreground">Community Registration Invites</h2>
          <p className="text-xs text-muted-foreground">
            VaultRealm is invite-only to protect host resources. Generate codes for friends and community players.
          </p>

          <div className="flex gap-2">
            <div className="flex-1">
              <input
                type="number"
                min={1}
                max={100}
                value={maxUses}
                onChange={(e) => setMaxUses(Number(e.target.value))}
                placeholder="Max uses"
                className="input w-full text-xs"
              />
            </div>
            <button
              onClick={handleCreateInvite}
              disabled={creating}
              className="btn btn-primary text-xs px-4 py-2 font-bold cursor-pointer shrink-0"
            >
              Generate Invite Code 🎟️
            </button>
          </div>

          <div className="space-y-2 mt-4 max-h-72 overflow-y-auto">
            {invites.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No active invites generated yet.</p>
            ) : (
              invites.map((inv) => (
                <div
                  key={inv.id}
                  className="p-3 rounded-lg border border-border bg-card-subtle flex items-center justify-between text-xs font-mono"
                >
                  <div>
                    <span className="font-bold text-primary mr-3">{inv.code}</span>
                    <span className="text-muted-foreground text-[10px]">
                      {inv.uses} / {inv.maxUses} uses
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(inv.code);
                        addToast({ type: 'info', title: 'Invite code copied!' });
                      }}
                      className="btn btn-secondary btn-sm text-[11px] py-1 px-2.5"
                    >
                      📋 Copy
                    </button>
                    <button
                      onClick={() => handleDeleteInvite(inv.id)}
                      className="btn btn-danger btn-sm text-[11px] py-1 px-2"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Host Node Specs */}
        <div className="card p-6 border border-border/80 space-y-4">
          <h2 className="text-base font-bold text-foreground">Host Infrastructure</h2>
          <p className="text-xs text-muted-foreground">
            Docker host node hardware and budget thresholds
          </p>

          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-2 border-b border-border/40">
              <span className="text-muted-foreground">Total Physical RAM</span>
              <span className="font-mono text-foreground font-bold">
                {capacity?.host.totalHostRamMb} MB
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-border/40">
              <span className="text-muted-foreground">Safety Budget Cap</span>
              <span className="font-mono text-primary font-bold">
                {capacity?.host.budgetPct}% ({capacity?.host.budgetRamMb} MB)
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-border/40">
              <span className="text-muted-foreground">Allocated Server Memory</span>
              <span className="font-mono text-foreground">
                {capacity?.host.allocatedRamMb} MB
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-border/40">
              <span className="text-muted-foreground">Available Allocation Buffer</span>
              <span className="font-mono text-emerald-400 font-bold">
                {capacity?.host.availableBudgetRamMb} MB
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
