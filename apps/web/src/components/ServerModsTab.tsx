import { useState, useEffect } from 'react';
import { api, type ServerDetail, type InstalledMod } from '../api/client';
import { useToast } from './Toast';

interface ServerModsTabProps {
  server: ServerDetail;
  onRestartServer?: () => void;
}

interface ModrinthHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon_url: string | null;
  downloads: number;
  categories: string[];
}

interface ModrinthSearchResponse {
  hits: ModrinthHit[];
  total_hits: number;
}

interface ModrinthVersionFile {
  url: string;
  filename: string;
  primary: boolean;
  size: number;
}

interface ModrinthVersion {
  id: string;
  name: string;
  game_versions: string[];
  loaders: string[];
  files: ModrinthVersionFile[];
}

export function ServerModsTab({ server, onRestartServer }: ServerModsTabProps) {
  const [subtab, setSubtab] = useState<'installed' | 'browse'>('browse');
  const [installedMods, setInstalledMods] = useState<InstalledMod[]>([]);
  const [addonsFolder, setAddonsFolder] = useState<'mods' | 'plugins'>('mods');
  const [loadingInstalled, setLoadingInstalled] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ModrinthHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const { addToast } = useToast();

  const loader = (server.serverType || 'fabric').toLowerCase();

  const loadInstalled = async () => {
    setLoadingInstalled(true);
    try {
      const res = await api.listServerMods(server.id);
      setInstalledMods(res.mods);
      setAddonsFolder(res.folder === 'plugins' ? 'plugins' : 'mods');
    } catch {
      // not available or error
    } finally {
      setLoadingInstalled(false);
    }
  };

  useEffect(() => {
    loadInstalled();
  }, [server.id]);

  // Search Modrinth API
  const searchModrinth = async (query = searchQuery) => {
    setIsSearching(true);
    try {
      // Map server type to Modrinth category facet
      let loaderFacet = 'fabric';
      if (loader.includes('forge') && !loader.includes('neo')) loaderFacet = 'forge';
      else if (loader.includes('neo')) loaderFacet = 'neoforge';
      else if (loader.includes('quilt')) loaderFacet = 'quilt';
      else if (loader.includes('paper') || loader.includes('purpur') || loader.includes('spigot')) loaderFacet = 'spigot';

      // Modrinth search query with facets
      const url = new URL('https://api.modrinth.com/v2/search');
      url.searchParams.set('query', query);
      url.searchParams.set('limit', '12');

      // Add loader facet
      const facets: string[][] = [[`categories:${loaderFacet}`]];
      if (server.version && server.version !== 'LATEST') {
        const cleanVer = server.version.replace(/^v/, '');
        facets.push([`versions:${cleanVer}`]);
      }
      url.searchParams.set('facets', JSON.stringify(facets));

      const res = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VaultRealm-Panel/0.5 (https://vaultsoftlabs.tech)',
        },
      });

      if (!res.ok) throw new Error(`Modrinth returned ${res.status}`);
      const data = (await res.json()) as ModrinthSearchResponse;
      setSearchResults(data.hits || []);
    } catch (err) {
      console.warn('Modrinth search failed, falling back without version constraint', err);
      // Fallback search without strict version facet
      try {
        const fallbackUrl = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=12&facets=[["categories:${loader}"]]`;
        const res = await fetch(fallbackUrl);
        const data = (await res.json()) as ModrinthSearchResponse;
        setSearchResults(data.hits || []);
      } catch {
        setSearchResults([]);
      }
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (subtab === 'browse') {
      searchModrinth(searchQuery);
    }
  }, [subtab]);

  // Install a mod directly from Modrinth
  const handleInstallMod = async (hit: ModrinthHit) => {
    setInstallingId(hit.project_id);
    try {
      // 1. Fetch available versions for this project
      const versionsUrl = `https://api.modrinth.com/v2/project/${hit.project_id}/version`;
      const vRes = await fetch(versionsUrl, {
        headers: {
          'User-Agent': 'VaultRealm-Panel/0.5 (https://vaultsoftlabs.tech)',
        },
      });
      if (!vRes.ok) throw new Error('Failed to retrieve mod version download');
      const versions = (await vRes.json()) as ModrinthVersion[];

      if (!versions || versions.length === 0) {
        throw new Error('No release versions available for this mod.');
      }

      // 2. Pick best matching version
      const targetVersion = server.version && server.version !== 'LATEST' ? server.version.replace(/^v/, '') : null;
      let matchedVersion = targetVersion
        ? versions.find((v) => v.game_versions.includes(targetVersion))
        : null;

      if (!matchedVersion) {
        matchedVersion = versions[0]; // pick latest
      }

      const primaryFile = matchedVersion?.files?.find((f) => f.primary) || matchedVersion?.files?.[0];
      if (!primaryFile) {
        throw new Error('No download file found for this mod version.');
      }

      // 3. Request panel backend to safely download .jar to /data/mods
      await api.installServerMod(server.id, {
        downloadUrl: primaryFile.url,
        filename: primaryFile.filename,
        projectId: hit.slug,
        title: hit.title,
      });

      addToast({
        type: 'success',
        title: `Installed ${hit.title}`,
        message: 'Mod installed into /mods folder. Restart your server to activate.',
      });

      await loadInstalled();
    } catch (err) {
      addToast({
        type: 'error',
        title: `Installation failed`,
        message: err instanceof Error ? err.message : 'Could not install mod.',
      });
    } finally {
      setInstallingId(null);
    }
  };

  const handleToggle = async (mod: InstalledMod) => {
    try {
      const res = await api.toggleServerMod(server.id, mod.filename, !mod.enabled);
      addToast({
        type: 'info',
        title: res.enabled ? 'Mod Enabled' : 'Mod Disabled',
        message: `${res.newFilename}. Restart server to apply.`,
      });
      await loadInstalled();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to toggle mod',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleDelete = async (filename: string) => {
    if (!confirm(`Are you sure you want to delete ${filename}?`)) return;
    try {
      await api.deleteServerMod(server.id, filename);
      addToast({ type: 'success', title: 'Mod removed', message: filename });
      await loadInstalled();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Strip with Controls */}
      <div className="card p-5 border border-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-base text-foreground flex items-center gap-2">
              <span>🧩</span> {addonsFolder === 'plugins' ? 'Plugins & Extensions' : 'Mods & Addons'}
            </h3>
            <span className="badge badge-info text-[10px] font-mono uppercase">
              {server.serverType || 'Standard'}
            </span>
            <span className="badge badge-neutral text-[10px] font-mono">
              {server.version || 'LATEST'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Browse and 1-click install open-source community mods from{' '}
            <a
              href="https://modrinth.com"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline font-mono"
            >
              Modrinth ↗
            </a>{' '}
            directly into your server’s <span className="font-mono text-foreground">/{addonsFolder}</span> folder.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Subtabs */}
          <div className="flex bg-card-subtle p-1 rounded-lg border border-border">
            <button
              onClick={() => setSubtab('browse')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                subtab === 'browse'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              🌐 Browse Modrinth
            </button>
            <button
              onClick={() => {
                setSubtab('installed');
                loadInstalled();
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                subtab === 'installed'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>📂 Installed</span>
              <span className="badge badge-neutral text-[9px] py-0 px-1">
                {installedMods.length}
              </span>
            </button>
          </div>

          {onRestartServer && (
            <button
              onClick={onRestartServer}
              className="btn btn-secondary text-xs py-1.5 px-3 flex items-center gap-1 text-amber-400 hover:text-amber-300 border-amber-500/30"
              title="Restart server to load new mods"
            >
              🔄 Restart Server
            </button>
          )}
        </div>
      </div>

      {/* ── Subtab 1: Browse Open Source Mods ──────────────────────────────── */}
      {subtab === 'browse' && (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder={`Search ${server.serverType || 'Fabric'} mods (e.g. Lithium, Voice Chat, Chunky)...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchModrinth(searchQuery)}
                className="input w-full text-xs pl-8 font-mono"
              />
              <span className="absolute left-2.5 top-2.5 text-xs text-muted-foreground">🔍</span>
            </div>
            <button
              onClick={() => searchModrinth(searchQuery)}
              disabled={isSearching}
              className="btn btn-primary text-xs px-4 font-semibold"
            >
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </div>

          {/* Quick-Picks Pills for Popular Server Mods */}
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="text-[11px] text-muted-foreground font-mono">Popular Server Addons:</span>
            {['Fabric API', 'Lithium', 'FerriteCore', 'Simple Voice Chat', 'Chunky', 'Spark'].map((preset) => (
              <button
                key={preset}
                onClick={() => {
                  setSearchQuery(preset);
                  searchModrinth(preset);
                }}
                className="bg-card-subtle hover:bg-muted text-foreground/80 hover:text-primary px-2 py-0.5 rounded text-[11px] border border-border/60 transition-colors font-mono"
              >
                + {preset}
              </button>
            ))}
          </div>

          {/* Results Grid */}
          {isSearching ? (
            <div className="card p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
              <span className="inline-block animate-spin text-2xl text-primary mb-2">⟳</span>
              <span className="text-xs font-mono">Querying Modrinth open-source community catalog...</span>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="card p-12 text-center text-muted-foreground">
              <span className="text-2xl mb-2 block">🔍</span>
              <p className="text-sm font-semibold text-foreground">No matching mods found</p>
              <p className="text-xs text-muted-foreground mt-1">
                Try searching for broader keywords or verify compatibility with {server.serverType}.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {searchResults.map((hit) => {
                const isInstalled = installedMods.some(
                  (m) => m.filename.toLowerCase().includes(hit.slug.toLowerCase()),
                );

                return (
                  <div
                    key={hit.project_id}
                    className="card p-4 border border-border flex flex-col justify-between hover:border-primary/40 transition-all group"
                  >
                    <div>
                      <div className="flex items-start gap-3">
                        {hit.icon_url ? (
                          <img
                            src={hit.icon_url}
                            alt={hit.title}
                            className="w-10 h-10 rounded-lg object-contain bg-muted/40 p-0.5 border border-border/50 shrink-0"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center text-lg shrink-0">
                            🧩
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-sm text-foreground group-hover:text-primary transition-colors truncate">
                            {hit.title}
                          </h4>
                          <span className="text-[10px] text-muted-foreground font-mono block truncate">
                            by {hit.author}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2 leading-relaxed">
                        {hit.description}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
                        <span>⬇</span> {hit.downloads.toLocaleString()}
                      </span>

                      <button
                        onClick={() => handleInstallMod(hit)}
                        disabled={installingId === hit.project_id}
                        className={`btn btn-sm ${
                          isInstalled
                            ? 'btn-secondary text-[10px] opacity-80'
                            : 'btn-primary text-xs font-bold shadow glow-primary'
                        }`}
                      >
                        {installingId === hit.project_id ? (
                          <span className="flex items-center gap-1">
                            <span className="animate-spin text-[10px]">⟳</span> Installing...
                          </span>
                        ) : isInstalled ? (
                          '✓ Installed (Reinstall)'
                        ) : (
                          '⬇ Install Mod'
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Subtab 2: Installed Mods ───────────────────────────────────────── */}
      {subtab === 'installed' && (
        <div className="space-y-4">
          {loadingInstalled ? (
            <div className="card p-12 text-center text-muted-foreground">
              <span className="animate-spin text-2xl text-primary inline-block mb-2">⟳</span>
              <p className="text-xs font-mono">Reading storage volume /{addonsFolder}...</p>
            </div>
          ) : installedMods.length === 0 ? (
            <div className="card p-12 text-center border border-dashed border-border/80">
              <span className="text-3xl mb-3 block">📦</span>
              <h4 className="font-bold text-base text-foreground">No mods installed yet</h4>
              <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                Your server’s <span className="font-mono text-foreground">/{addonsFolder}</span> folder is currently empty.
                Switch to the <span className="text-primary font-semibold">Browse Modrinth</span> tab to install popular
                mods with a single click.
              </p>
              <button
                onClick={() => setSubtab('browse')}
                className="btn btn-primary text-xs font-bold py-2 px-4 mt-4"
              >
                Browse Open-Source Mods 🚀
              </button>
            </div>
          ) : (
            <div className="card overflow-hidden border border-border">
              <div className="p-3.5 bg-card-subtle border-b border-border flex items-center justify-between text-xs font-semibold">
                <span className="text-foreground">
                  Installed Addons in /{addonsFolder} ({installedMods.length})
                </span>
                <span className="text-[11px] text-muted-foreground font-mono">
                  Changes take effect after server restart
                </span>
              </div>

              <div className="divide-y divide-border/40">
                {installedMods.map((mod) => (
                  <div
                    key={mod.filename}
                    className="p-3.5 flex items-center justify-between hover:bg-muted/10 transition-colors gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-base">{mod.enabled ? '🟢' : '⚪'}</span>
                      <div className="min-w-0">
                        <span
                          className={`font-mono text-xs font-semibold block truncate ${
                            mod.enabled ? 'text-foreground' : 'text-muted-foreground line-through'
                          }`}
                        >
                          {mod.filename}
                        </span>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono mt-0.5">
                          <span>{formatFileSize(mod.sizeBytes)}</span>
                          <span>•</span>
                          <span>
                            {mod.enabled ? (
                              <span className="text-emerald-400 font-bold">ACTIVE</span>
                            ) : (
                              <span className="text-amber-400 font-bold">DISABLED</span>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleToggle(mod)}
                        className="btn btn-secondary text-xs py-1 px-2.5 font-mono"
                        title={mod.enabled ? 'Disable mod (adds .disabled)' : 'Enable mod'}
                      >
                        {mod.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => handleDelete(mod.filename)}
                        className="btn btn-secondary text-xs py-1 px-2.5 text-red-400 hover:text-red-300 border-red-500/20"
                        title="Delete mod file"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
