import { useState, useId } from 'react';
import type { ServerDetail, ContainerStats } from '../api/client';

export interface MetricSnapshot {
  timestamp: string;
  timeLabel: string;
  cpuPercent: number;
  memoryUsageMb: number;
  memoryLimitMb: number;
  memoryPercent: number;
  diskUsedMb: number;
  diskLimitMb: number;
  diskPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
  rxSpeedBps: number;
  txSpeedBps: number;
  pids: number;
}

interface ServerMetricsProps {
  server: ServerDetail;
  stats: ContainerStats | null;
  history: MetricSnapshot[];
  onClearHistory?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '0 B/s';
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
}

function formatUptime(startedAt: string | null): string {
  if (!startedAt) return 'Stopped';
  const now = Date.now();
  const start = new Date(startedAt).getTime();
  const diffSec = Math.max(0, Math.floor((now - start) / 1000));
  if (diffSec === 0) return 'Just started';

  const d = Math.floor(diffSec / 86400);
  const h = Math.floor((diffSec % 86400) / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;

  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

interface SparklineProps {
  data: number[];
  color?: string;
  fillColor?: string;
  secondaryData?: number[];
  secondaryColor?: string;
  height?: number;
  min?: number;
  max?: number;
}

function Sparkline({
  data,
  color = '#8b5cf6',
  fillColor,
  secondaryData,
  secondaryColor = '#10b981',
  height = 54,
  min,
  max,
}: SparklineProps) {
  const gradientId = useId();
  const secGradientId = useId();

  if (data.length === 0) {
    return (
      <div
        className="w-full flex items-center justify-center border border-dashed border-border/50 rounded bg-card/20 text-muted-foreground/60 text-[10px]"
        style={{ height }}
      >
        Waiting for metrics stream...
      </div>
    );
  }

  const allValues = [...data, ...(secondaryData ?? [])];
  const minVal = min !== undefined ? min : Math.min(...allValues, 0);
  const maxVal = max !== undefined ? Math.max(max, ...allValues) : Math.max(...allValues, 1);
  const range = maxVal - minVal || 1;
  const width = 240;

  const buildPath = (vals: number[]) => {
    if (vals.length === 1) {
      const y = height - ((vals[0]! - minVal) / range) * (height - 10) - 5;
      return {
        lineD: `M 0,${y.toFixed(1)} L ${width},${y.toFixed(1)}`,
        areaD: `M 0,${y.toFixed(1)} L ${width},${y.toFixed(1)} L ${width},${height} L 0,${height} Z`,
      };
    }

    const points = vals.map((val, i) => {
      const x = (i / (vals.length - 1)) * width;
      const y = height - ((Math.max(minVal, Math.min(maxVal, val)) - minVal) / range) * (height - 10) - 5;
      return { x, y };
    });

    const lineD = points.map((p, i) => (i === 0 ? `M ${p.x.toFixed(1)},${p.y.toFixed(1)}` : `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`)).join(' ');
    const areaD = `${lineD} L ${width},${height} L 0,${height} Z`;
    return { lineD, areaD };
  };

  const primary = buildPath(data);
  const secondary = secondaryData && secondaryData.length > 0 ? buildPath(secondaryData) : null;

  return (
    <div className="w-full overflow-hidden" style={{ height }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-full overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillColor || color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={fillColor || color} stopOpacity="0.0" />
          </linearGradient>
          {secondary && (
            <linearGradient id={secGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={secondaryColor} stopOpacity="0.25" />
              <stop offset="100%" stopColor={secondaryColor} stopOpacity="0.0" />
            </linearGradient>
          )}
        </defs>

        {/* Secondary area & line if present (e.g. download) */}
        {secondary && (
          <>
            <path d={secondary.areaD} fill={`url(#${secGradientId})`} />
            <path
              d={secondary.lineD}
              fill="none"
              stroke={secondaryColor}
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}

        {/* Primary area & line (e.g. upload or metric) */}
        <path d={primary.areaD} fill={`url(#${gradientId})`} />
        <path
          d={primary.lineD}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function ServerMetrics({ server, stats, history, onClearHistory }: ServerMetricsProps) {
  const [showLogTable, setShowLogTable] = useState(true);
  const [logLimit, setLogLimit] = useState<number>(20);

  const isRunning = server.status === 'running';

  // Extract history series
  const cpuSeries = history.map((h) => h.cpuPercent);
  const ramSeries = history.map((h) => h.memoryPercent);
  const txSpeedSeries = history.map((h) => h.txSpeedBps);
  const rxSpeedSeries = history.map((h) => h.rxSpeedBps);

  // Computed metrics
  const avgCpu = cpuSeries.length > 0 ? (cpuSeries.reduce((a, b) => a + b, 0) / cpuSeries.length).toFixed(1) : '0.0';
  const peakCpu = cpuSeries.length > 0 ? Math.max(...cpuSeries).toFixed(1) : '0.0';

  const avgRam = ramSeries.length > 0 ? (ramSeries.reduce((a, b) => a + b, 0) / ramSeries.length).toFixed(1) : '0.0';
  const peakRam = ramSeries.length > 0 ? Math.max(...ramSeries).toFixed(1) : '0.0';

  const currentSnapshot = history[history.length - 1];
  const currentTxSpeed = currentSnapshot?.txSpeedBps ?? 0;
  const currentRxSpeed = currentSnapshot?.rxSpeedBps ?? 0;

  const avgTxSpeed = txSpeedSeries.length > 0 ? txSpeedSeries.reduce((a, b) => a + b, 0) / txSpeedSeries.length : 0;
  const avgRxSpeed = rxSpeedSeries.length > 0 ? rxSpeedSeries.reduce((a, b) => a + b, 0) / rxSpeedSeries.length : 0;

  const diskUsedMb = stats?.diskUsedMb ?? 0;
  const diskLimitMb = server.diskLimitMb ?? 10240;
  const diskPercent = stats?.diskPercent ?? (diskLimitMb > 0 ? Math.min(100, (diskUsedMb / diskLimitMb) * 100) : 0);
  const diskFreeMb = Math.max(0, diskLimitMb - diskUsedMb);

  const exportCsv = () => {
    if (history.length === 0) return;
    const header = 'Timestamp,CPU_Percent,RAM_Used_MB,RAM_Limit_MB,RAM_Percent,Disk_Used_MB,Disk_Limit_MB,TX_Speed_Bps,RX_Speed_Bps,PIDs\n';
    const rows = history
      .map(
        (h) =>
          `"${h.timestamp}",${h.cpuPercent.toFixed(2)},${h.memoryUsageMb.toFixed(2)},${h.memoryLimitMb},${h.memoryPercent.toFixed(2)},${h.diskUsedMb.toFixed(2)},${h.diskLimitMb},${h.txSpeedBps.toFixed(0)},${h.rxSpeedBps.toFixed(0)},${h.pids}`,
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `metrics-${server.name.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* ── Top Metric Cards (CPU, RAM, Storage, System) ───────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CPU Card */}
        <div className="card p-5 border border-border/80 relative overflow-hidden flex flex-col justify-between hover:border-primary/50 transition-colors">
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-cyan-400" />
                CPU Usage
              </span>
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span title="Average over window">AVG {avgCpu}%</span>
                <span className="text-border">•</span>
                <span className="text-cyan-400" title="Peak usage">PEAK {peakCpu}%</span>
              </div>
            </div>

            <div className="flex items-baseline gap-2 mt-2">
              <div className="text-2xl font-bold font-mono text-foreground">
                {isRunning ? (stats?.cpuPercent ?? 0).toFixed(1) : '0.0'}
                <span className="text-sm font-normal text-muted-foreground ml-1">%</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {server.cpuLimit} Core{server.cpuLimit > 1 ? 's' : ''} Limit
              </span>
            </div>
          </div>

          <div className="mt-4">
            <Sparkline
              data={cpuSeries}
              color="#06b6d4"
              fillColor="#06b6d4"
              min={0}
              max={Math.max(100, Number(peakCpu) * 1.1)}
            />
          </div>
        </div>

        {/* RAM Card */}
        <div className="card p-5 border border-border/80 relative overflow-hidden flex flex-col justify-between hover:border-primary/50 transition-colors">
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-purple-400" />
                RAM Allocation
              </span>
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span title="Average RAM">AVG {avgRam}%</span>
                <span className="text-border">•</span>
                <span className="text-purple-400" title="Peak RAM">PEAK {peakRam}%</span>
              </div>
            </div>

            <div className="flex items-baseline gap-2 mt-2">
              <div className="text-2xl font-bold font-mono text-foreground">
                {isRunning ? (stats?.memoryPercent ?? 0).toFixed(1) : '0.0'}
                <span className="text-sm font-normal text-muted-foreground ml-1">%</span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {isRunning ? (stats?.memoryUsageMb ?? 0).toFixed(0) : 0} / {server.ramMb} MB
              </span>
            </div>
          </div>

          <div className="mt-4">
            <Sparkline
              data={ramSeries}
              color="#a855f7"
              fillColor="#a855f7"
              min={0}
              max={100}
            />
          </div>
        </div>

        {/* Storage / Disk Card */}
        <div className="card p-5 border border-border/80 relative overflow-hidden flex flex-col justify-between hover:border-primary/50 transition-colors">
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                Storage / Disk
              </span>
              <span className="font-mono text-[11px] text-emerald-400">
                FREE {diskFreeMb > 1024 ? `${(diskFreeMb / 1024).toFixed(1)} GB` : `${diskFreeMb.toFixed(0)} MB`}
              </span>
            </div>

            <div className="flex items-baseline gap-2 mt-2">
              <div className="text-2xl font-bold font-mono text-foreground">
                {diskPercent.toFixed(1)}
                <span className="text-sm font-normal text-muted-foreground ml-1">%</span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {diskUsedMb.toFixed(0)} MB / {diskLimitMb} MB
              </span>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="w-full bg-muted/60 rounded-full h-2 overflow-hidden border border-border/40">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  diskPercent > 85 ? 'bg-red-500' : diskPercent > 70 ? 'bg-amber-400' : 'bg-primary'
                }`}
                style={{ width: `${Math.min(100, diskPercent)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
              <span>Path: /data</span>
              <span>Isolated Volume</span>
            </div>
          </div>
        </div>

        {/* Runtime & PIDs Card */}
        <div className="card p-5 border border-border/80 relative overflow-hidden flex flex-col justify-between hover:border-primary/50 transition-colors">
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
                Uptime & Processes
              </span>
              <span className={`badge ${isRunning ? 'badge-success' : 'badge-neutral'} text-[10px] py-0 px-1.5`}>
                {server.status}
              </span>
            </div>

            <div className="mt-2">
              <div className="text-2xl font-bold font-mono text-foreground" title={server.lastStartedAt ?? ''}>
                {isRunning ? formatUptime(server.lastStartedAt) : 'Offline'}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Process Uptime
              </p>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 font-mono">
              <span className="text-muted-foreground">PIDs:</span>
              <span className="font-semibold text-foreground">{isRunning ? (stats?.pids ?? 0) : 0}</span>
              <span className="text-[10px] text-muted-foreground">active</span>
            </div>
            <span className="text-[11px] font-mono text-primary font-medium">{server.templateName}</span>
          </div>
        </div>
      </div>

      {/* ── Network Traffic & Speed Card ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-5 border border-border/80 flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                  Network Activity & Speed
                </h3>
                <span className="badge badge-neutral text-[10px]">Realtime</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Live I/O transfer rates for connected players and game asset sync
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-cyan-400" />
                <span className="text-muted-foreground">TX:</span>
                <span className="font-semibold text-cyan-400">{formatSpeed(currentTxSpeed)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-muted-foreground">RX:</span>
                <span className="font-semibold text-emerald-400">{formatSpeed(currentRxSpeed)}</span>
              </div>
            </div>
          </div>

          {/* Dual-line Graph for Upload and Download */}
          <div className="my-3">
            <Sparkline
              data={txSpeedSeries}
              color="#06b6d4"
              fillColor="#06b6d4"
              secondaryData={rxSpeedSeries}
              secondaryColor="#10b981"
              height={70}
            />
          </div>

          <div className="pt-3 border-t border-border/60 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div>
              <span className="text-muted-foreground text-[10px] block">TOTAL SENT (TX)</span>
              <span className="font-semibold text-foreground">
                {formatBytes(stats?.networkTxBytes ?? 0)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground text-[10px] block">TOTAL RECEIVED (RX)</span>
              <span className="font-semibold text-foreground">
                {formatBytes(stats?.networkRxBytes ?? 0)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground text-[10px] block">AVG TX SPEED</span>
              <span className="text-cyan-400 font-semibold">{formatSpeed(avgTxSpeed)}</span>
            </div>
            <div>
              <span className="text-muted-foreground text-[10px] block">AVG RX SPEED</span>
              <span className="text-emerald-400 font-semibold">{formatSpeed(avgRxSpeed)}</span>
            </div>
          </div>
        </div>

        {/* Port Bindings & Connection Info */}
        <div className="card p-5 border border-border/80 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-1">
              Port Bindings
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              Container network interfaces forwarded to host
            </p>

            <div className="space-y-2">
              {server.ports.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-card-subtle border border-border/60 text-xs font-mono"
                >
                  <div className="flex items-center gap-2">
                    <span className="badge badge-primary text-[10px] py-0 px-1.5">{p.protocol.toUpperCase()}</span>
                    <span className="font-semibold text-foreground">{p.name}</span>
                  </div>
                  <span className="text-primary font-bold">
                    {p.hostPort} ➔ {p.containerPort}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border/60 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Bridge Mode</span>
              <span className="badge badge-success text-[10px] py-0 px-1.5">Active</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Live Metrics Log Table ─────────────────────────────────────────── */}
      <div className="card overflow-hidden border border-border/80 shadow-md">
        <div className="px-5 py-3.5 bg-card-subtle border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-base">📈</span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Live Metrics Stream Log</h3>
              <p className="text-[11px] text-muted-foreground">
                Time-series resource snapshots captured from container telemetry
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground text-[11px]">Rows:</span>
              <select
                value={logLimit}
                onChange={(e) => setLogLimit(Number(e.target.value))}
                className="bg-muted border border-border rounded px-2 py-1 text-xs text-foreground font-mono focus:outline-none"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
              </select>
            </div>

            <button
              onClick={exportCsv}
              disabled={history.length === 0}
              className="btn btn-secondary btn-sm text-xs py-1 px-2.5 flex items-center gap-1.5 disabled:opacity-50"
              title="Download metrics as CSV"
            >
              <span>📥</span> Export CSV
            </button>

            {onClearHistory && (
              <button
                onClick={onClearHistory}
                className="btn btn-ghost btn-sm text-xs py-1 px-2 text-muted-foreground hover:text-foreground"
                title="Clear metrics memory buffer"
              >
                Clear
              </button>
            )}

            <button
              onClick={() => setShowLogTable(!showLogTable)}
              className="btn btn-ghost btn-sm text-xs py-1 px-2"
            >
              {showLogTable ? '▲ Collapse' : '▼ Expand'}
            </button>
          </div>
        </div>

        {showLogTable && (
          <div className="overflow-x-auto">
            {history.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                {isRunning
                  ? 'Collecting initial performance metrics from container engine...'
                  : 'Start the server to stream real-time metrics.'}
              </div>
            ) : (
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-muted/40 text-muted-foreground border-b border-border/60 text-[11px]">
                  <tr>
                    <th className="py-2 px-4">Time</th>
                    <th className="py-2 px-4">CPU %</th>
                    <th className="py-2 px-4">RAM Usage</th>
                    <th className="py-2 px-4">Storage (Disk)</th>
                    <th className="py-2 px-4">Upload (TX)</th>
                    <th className="py-2 px-4">Download (RX)</th>
                    <th className="py-2 px-4">PIDs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {history
                    .slice(-logLimit)
                    .reverse()
                    .map((item, idx) => (
                      <tr key={idx} className="hover:bg-muted/20 transition-colors">
                        <td className="py-2 px-4 text-muted-foreground whitespace-nowrap">
                          {item.timeLabel}
                        </td>
                        <td className="py-2 px-4 whitespace-nowrap font-semibold">
                          <span
                            className={
                              item.cpuPercent > 80
                                ? 'text-red-400'
                                : item.cpuPercent > 50
                                  ? 'text-amber-400'
                                  : 'text-cyan-400'
                            }
                          >
                            {item.cpuPercent.toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-2 px-4 whitespace-nowrap">
                          <span className="font-semibold text-purple-300">
                            {item.memoryUsageMb.toFixed(0)} MB
                          </span>{' '}
                          <span className="text-[10px] text-muted-foreground">
                            ({item.memoryPercent.toFixed(0)}%)
                          </span>
                        </td>
                        <td className="py-2 px-4 whitespace-nowrap text-amber-200">
                          {item.diskUsedMb.toFixed(0)} MB{' '}
                          <span className="text-[10px] text-muted-foreground">
                            ({item.diskPercent.toFixed(0)}%)
                          </span>
                        </td>
                        <td className="py-2 px-4 whitespace-nowrap text-cyan-400">
                          {formatSpeed(item.txSpeedBps)}
                        </td>
                        <td className="py-2 px-4 whitespace-nowrap text-emerald-400">
                          {formatSpeed(item.rxSpeedBps)}
                        </td>
                        <td className="py-2 px-4 whitespace-nowrap text-foreground">
                          {item.pids}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

