import { describe, it, expect, beforeEach } from 'vitest';
import { MockDockerDriver } from '../src/docker/mock.js';

describe('MockDockerDriver', () => {
  let driver: MockDockerDriver;

  beforeEach(() => {
    driver = new MockDockerDriver();
  });

  const baseOpts = {
    name: 'test-server',
    image: 'itzg/minecraft-server:latest',
    env: { EULA: 'TRUE', MEMORY: '2048M' },
    labels: { 'gamepanel.server': 'srv-001' },
    ports: [{ hostPort: 25565, containerPort: 25565, protocol: 'tcp' as const }],
    volumes: [{ hostPath: '/data/servers/srv-001', containerPath: '/data' }],
    memoryMb: 2048,
    cpuLimit: 1,
  };

  describe('container lifecycle', () => {
    it('creates a container and returns an ID', async () => {
      const id = await driver.createContainer(baseOpts);
      expect(id).toBeTruthy();
      expect(driver.containers.has(id)).toBe(true);
    });

    it('starts a container', async () => {
      const id = await driver.createContainer(baseOpts);
      await driver.startContainer(id);

      const info = await driver.inspectContainer(id);
      expect(info.state.running).toBe(true);
      expect(info.state.status).toBe('running');
    });

    it('stops a container', async () => {
      const id = await driver.createContainer(baseOpts);
      await driver.startContainer(id);
      await driver.stopContainer(id);

      const info = await driver.inspectContainer(id);
      expect(info.state.running).toBe(false);
      expect(info.state.status).toBe('exited');
      expect(info.state.exitCode).toBe(0);
    });

    it('kills a container with exit code 137', async () => {
      const id = await driver.createContainer(baseOpts);
      await driver.startContainer(id);
      await driver.killContainer(id, 'SIGKILL');

      const info = await driver.inspectContainer(id);
      expect(info.state.running).toBe(false);
      expect(info.state.exitCode).toBe(137);
    });

    it('restarts a container', async () => {
      const id = await driver.createContainer(baseOpts);
      await driver.startContainer(id);
      await driver.restartContainer(id);

      const info = await driver.inspectContainer(id);
      expect(info.state.running).toBe(true);
    });

    it('removes a stopped container', async () => {
      const id = await driver.createContainer(baseOpts);
      await driver.removeContainer(id);
      expect(driver.containers.has(id)).toBe(false);
    });

    it('rejects removing a running container', async () => {
      const id = await driver.createContainer(baseOpts);
      await driver.startContainer(id);
      await expect(driver.removeContainer(id)).rejects.toThrow('running container');
    });

    it('throws for non-existent container', async () => {
      await expect(driver.inspectContainer('nope')).rejects.toThrow('not found');
    });
  });

  describe('inspect', () => {
    it('returns correct container details', async () => {
      const id = await driver.createContainer(baseOpts);
      const info = await driver.inspectContainer(id);

      expect(info.id).toBe(id);
      expect(info.image).toBe('itzg/minecraft-server:latest');
      expect(info.config.labels['gamepanel.server']).toBe('srv-001');
      expect(info.config.env).toContain('EULA=TRUE');
      expect(info.hostConfig.memory).toBe(2048 * 1024 * 1024);
    });
  });

  describe('logs', () => {
    it('adds and retrieves logs', async () => {
      const id = await driver.createContainer(baseOpts);
      driver.addLogs(id, ['[INFO] Starting server...', '[INFO] Done (2.3s)!']);

      const logs = await driver.getContainerLogs(id);
      expect(logs).toHaveLength(2);
      expect(logs[0]).toContain('Starting server');
    });

    it('respects tail parameter', async () => {
      const id = await driver.createContainer(baseOpts);
      driver.addLogs(id, ['line1', 'line2', 'line3', 'line4', 'line5']);

      const logs = await driver.getContainerLogs(id, 2);
      expect(logs).toEqual(['line4', 'line5']);
    });
  });

  describe('images', () => {
    it('pulls and tracks images', async () => {
      expect(await driver.hasImage('test:latest')).toBe(false);

      const progressUpdates: number[] = [];
      await driver.pullImage('test:latest', (p) => {
        if (p.progressPercent !== undefined) {
          progressUpdates.push(p.progressPercent);
        }
      });

      expect(await driver.hasImage('test:latest')).toBe(true);
      expect(progressUpdates).toContain(100);
    });
  });

  describe('simulated failures', () => {
    it('simulates OOM kill', async () => {
      const id = await driver.createContainer(baseOpts);
      await driver.startContainer(id);
      driver.simulateOomKill(id);

      const info = await driver.inspectContainer(id);
      expect(info.state.oomKilled).toBe(true);
      expect(info.state.exitCode).toBe(137);
      expect(info.state.running).toBe(false);
    });

    it('simulates crash with custom exit code', async () => {
      const id = await driver.createContainer(baseOpts);
      await driver.startContainer(id);
      driver.simulateCrash(id, 1);

      const info = await driver.inspectContainer(id);
      expect(info.state.exitCode).toBe(1);
      expect(info.state.running).toBe(false);
    });

    it('triggers onCreateContainer hook', async () => {
      driver.onCreateContainer = () => {
        throw new Error('Simulated create failure');
      };

      await expect(driver.createContainer(baseOpts)).rejects.toThrow('Simulated create failure');
    });
  });

  describe('listing and filtering', () => {
    it('lists all containers', async () => {
      await driver.createContainer(baseOpts);
      await driver.createContainer({
        ...baseOpts,
        name: 'test-server-2',
        labels: { 'gamepanel.server': 'srv-002' },
        ports: [{ hostPort: 25566, containerPort: 25565, protocol: 'tcp' }],
      });

      const all = await driver.listContainers();
      expect(all).toHaveLength(2);
    });

    it('filters by label', async () => {
      await driver.createContainer(baseOpts);
      await driver.createContainer({
        ...baseOpts,
        name: 'other',
        labels: { 'gamepanel.bot': 'bot-001' },
        ports: [{ hostPort: 25566, containerPort: 25565, protocol: 'tcp' }],
      });

      const filtered = await driver.listContainers({ 'gamepanel.server': 'srv-001' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.name).toBe('test-server');
    });
  });

  describe('host info', () => {
    it('returns mock host info', async () => {
      const info = await driver.getHostInfo();
      expect(info.dockerVersion).toContain('mock');
      expect(info.totalMemoryMb).toBeGreaterThan(0);
      expect(info.cpus).toBeGreaterThan(0);
    });
  });

  describe('networks', () => {
    it('creates and returns a network', async () => {
      const id = await driver.ensureNetwork('gamepanel');
      expect(id).toBe('net-gamepanel');

      // Idempotent
      const id2 = await driver.ensureNetwork('gamepanel');
      expect(id2).toBe(id);
    });
  });

  describe('resource updates', () => {
    it('updates container memory', async () => {
      const id = await driver.createContainer(baseOpts);
      await driver.updateContainer(id, { memoryMb: 4096 });

      const container = driver.containers.get(id)!;
      expect(container.config.memoryMb).toBe(4096);
    });
  });

  describe('reset', () => {
    it('clears all state', async () => {
      await driver.createContainer(baseOpts);
      await driver.pullImage('test:latest');
      await driver.ensureNetwork('test-net');

      driver.reset();

      expect(driver.containers.size).toBe(0);
      expect(driver.images.size).toBe(0);
      expect(driver.networks.size).toBe(0);
    });
  });
});
