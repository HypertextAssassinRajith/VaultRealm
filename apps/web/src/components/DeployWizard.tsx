import { useState, useEffect } from 'react';
import { api, type GameTemplate, type CapacityStatus, type ApiError } from '../api/client';
import { useToast } from './Toast';

interface DeployWizardProps {
  onClose: () => void;
  onSuccess: (serverId: string) => void;
}

interface StepEvent {
  step: number;
  stepName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message: string;
  percent?: number;
}

export function DeployWizard({ onClose, onSuccess }: DeployWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [templates, setTemplates] = useState<GameTemplate[]>([]);
  const [capacity, setCapacity] = useState<CapacityStatus | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<GameTemplate | null>(null);
  const [serverName, setServerName] = useState('');
  const [ramMb, setRamMb] = useState(2048);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [deployEvents, setDeployEvents] = useState<StepEvent[]>([
    { step: 1, stepName: 'validate', status: 'pending', message: 'Validate template & input parameters' },
    { step: 2, stepName: 'quota', status: 'pending', message: 'Verify user quota & host capacity' },
    { step: 3, stepName: 'ports', status: 'pending', message: 'Allocate host ports from range' },
    { step: 4, stepName: 'volume', status: 'pending', message: 'Prepare persistent storage volume' },
    { step: 5, stepName: 'pull', status: 'pending', message: 'Pull Docker image' },
    { step: 6, stepName: 'create', status: 'pending', message: 'Create hardened Docker container' },
    { step: 7, stepName: 'start', status: 'pending', message: 'Start container process' },
    { step: 8, stepName: 'verify', status: 'pending', message: 'Verify container readiness' },
    { step: 9, stepName: 'done', status: 'pending', message: 'Server deployment complete' },
  ]);

  const { addToast } = useToast();

  useEffect(() => {
    api.listTemplates().then(setTemplates).catch(console.error);
    api.getCapacity().then(setCapacity).catch(console.error);
  }, []);

  const handleSelectTemplate = (t: GameTemplate) => {
    setSelectedTemplate(t);
    setServerName(`My ${t.name} Server`);
    setRamMb(t.defaultRamMb);

    // Default envs
    const defaults: Record<string, string> = {};
    for (const e of t.env) {
      if (e.default !== undefined) {
        defaults[e.key] = e.default;
      }
    }
    setEnvValues(defaults);
    setStep(2);
  };

  const handleStartDeploy = async () => {
    if (!selectedTemplate) return;
    setLoading(true);
    setStep(3);

    try {
      const res = await api.deployServer({
        name: serverName,
        templateId: selectedTemplate.id,
        ramMb,
        env: envValues,
      });

      const serverId = res.id;

      // Subscribe to Server-Sent Events (SSE) for 9-step progress
      // withCredentials is required so the browser sends the session cookie
      const eventSource = new EventSource(`/api/servers/${serverId}/deploy-stream`, {
        withCredentials: true,
      });

      eventSource.onmessage = (event) => {
        try {
          const data: StepEvent = JSON.parse(event.data);
          setDeployEvents((prev) =>
            prev.map((item) =>
              item.step === data.step
                ? { ...item, status: data.status, message: data.message, percent: data.percent }
                : item,
            ),
          );

          if (data.step === 9 && data.status === 'completed') {
            eventSource.close();
            addToast({ type: 'success', title: 'Server deployed successfully!' });
            setTimeout(() => onSuccess(serverId), 1200);
          } else if (data.status === 'failed') {
            eventSource.close();
            addToast({ type: 'error', title: 'Deployment encountered an issue', message: data.message });
          }
        } catch {
          // ignore parse error
        }
      };

      eventSource.onerror = () => {
        // SSE closed or finished
        eventSource.close();
      };
    } catch (err) {
      const error = err as ApiError;
      addToast({ type: 'error', title: 'Deployment Blocked', message: error.message, details: error.details });
      setStep(2);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
      <div className="card max-w-2xl w-full p-8 border border-border shadow-2xl relative max-h-[90vh] flex flex-col glow-primary">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border mb-6">
          <div>
            <h2 className="text-xl font-bold gradient-text">One-Click Deploy Wizard</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {step === 1 && 'Step 1: Choose a game template to deploy'}
              {step === 2 && `Step 2: Configure ${selectedTemplate?.name} specifications`}
              {step === 3 && 'Step 3: Tracking deployment state machine'}
            </p>
          </div>
          <button
            onClick={() => {
              if (step === 3) {
                addToast({ type: 'info', title: 'Deployment continuing in background.' });
              }
              onClose();
            }}
            className="btn btn-ghost btn-sm p-1 text-base leading-none"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Step 1: Template Selection */}
        {step === 1 && (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {templates.map((t) => (
                <div
                  key={t.id}
                  onClick={() => handleSelectTemplate(t)}
                  className="p-4 rounded-xl border border-border bg-card/60 hover:bg-card hover:border-primary/50 cursor-pointer transition-all duration-200 group flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                        {t.category}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        Min {Math.round(t.minRamMb / 1024)} GB RAM
                      </span>
                    </div>
                    <h3 className="font-bold text-base text-foreground group-hover:text-primary transition-colors">
                      {t.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {t.description}
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t.ports.map((p) => `${p.containerPort}/${p.protocol}`).join(', ')}</span>
                    <span className="text-primary font-medium group-hover:translate-x-1 transition-transform">
                      Select →
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Configuration */}
        {step === 2 && selectedTemplate && (
          <div className="flex-1 overflow-y-auto space-y-5 pr-1">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
                Server Name
              </label>
              <input
                type="text"
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                className="input w-full"
                placeholder="My Server"
              />
            </div>

            {/* RAM Slider */}
            <div className="card p-4 border border-border/60 bg-muted/20">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  RAM Allocation
                </span>
                <span className="text-sm font-bold text-primary font-mono">
                  {ramMb} MB ({Math.round(ramMb / 1024)} GB)
                </span>
              </div>
              <input
                type="range"
                min={selectedTemplate.minRamMb}
                max={Math.min(16384, capacity?.host.availableBudgetRamMb ?? 16384)}
                step={512}
                value={ramMb}
                onChange={(e) => setRamMb(Number(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1 font-mono">
                <span>Min: {selectedTemplate.minRamMb} MB</span>
                <span>Rec: {selectedTemplate.defaultRamMb} MB</span>
                <span>Max: {capacity ? `${capacity.host.availableBudgetRamMb} MB` : '16 GB'}</span>
              </div>
            </div>

            {/* Template Environment Variables */}
            <div className="space-y-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Server Settings
              </span>
              {selectedTemplate.env
                .filter((e) => e.key !== 'MEMORY' && e.key !== 'EULA')
                .slice(0, 3)
                .map((env) => (
                  <div key={env.key}>
                    <label className="block text-xs text-foreground mb-1">
                      {env.label} <span className="text-[10px] text-muted-foreground font-mono">({env.key})</span>
                    </label>
                    <input
                      type="text"
                      value={envValues[env.key] ?? ''}
                      onChange={(e) => setEnvValues({ ...envValues, [env.key]: e.target.value })}
                      className="input w-full text-xs"
                    />
                  </div>
                ))}
            </div>

            <div className="pt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="btn btn-secondary flex-1 py-2 font-medium"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleStartDeploy}
                disabled={loading || !serverName}
                className="btn btn-primary flex-[2] py-2 font-bold"
              >
                Deploy Server Now 🚀
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Deployment Progress */}
        {step === 3 && (
          <div className="flex-1 overflow-y-auto space-y-3 py-2 pr-1">
            <div className="space-y-2">
              {deployEvents.map((item) => (
                <div
                  key={item.step}
                  className={`p-3 rounded-lg border text-xs flex items-center justify-between transition-all duration-300 ${
                    item.status === 'completed'
                      ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                      : item.status === 'running'
                        ? 'bg-primary/10 border-primary text-primary animate-pulse'
                        : item.status === 'failed'
                          ? 'bg-destructive/20 border-destructive text-destructive'
                          : 'bg-muted/20 border-border/40 text-muted-foreground opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold w-4">{item.step}.</span>
                    <span>{item.message}</span>
                  </div>
                  <div>
                    {item.status === 'completed' && <span>✓</span>}
                    {item.status === 'running' && (
                      <span className="animate-spin inline-block">⟳</span>
                    )}
                    {item.status === 'failed' && <span>✗</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-border mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block animate-spin text-primary">⟳</span>
                <span>Deploying server in background...</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  addToast({ type: 'info', title: 'Deployment continuing in background.' });
                  onClose();
                }}
                className="btn btn-secondary btn-sm text-xs py-1 px-3"
              >
                Continue in Background
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
