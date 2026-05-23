#!/usr/bin/env -S npx -y tsx
/**
 * Install and configure ThunderHub — a Lightning Network node manager.
 *
 * Run with:
 *   npx -y tsx scripts/install_thunderhub.ts \
 *     --goal <lnd|litd> \
 *     --node-type <self-hosted|voltage> \
 *     --server-url <host:port> \
 *     --macaroon-path <path> \
 *     --method <docker|source> \
 *     [--tls-cert-path <path>] \
 *     [--port <port>]
 *
 * Requires Node.js >= 18 (uses built-in fetch).
 * `tsx` is auto-fetched by npx — no `npm install` needed.
 *
 * Exit codes:
 *   0  success
 *   1  validation error (bad input)
 *   2  runtime / system error
 *
 * Output: JSON to stdout.
 */

import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THUNDERHUB_REPO = 'https://github.com/apotdevin/thunderhub.git';
const DOCKER_IMAGE = 'ghcr.io/apotdevin/thunderhub:latest';
const REQUIRED_NODE_MAJOR = 24;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Goal = 'lnd' | 'litd';
type NodeType = 'self-hosted' | 'voltage';
type InstallMethod = 'docker' | 'source';

type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'DOCKER_NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'DOCKER_ERROR'
  | 'INSTALL_ERROR'
  | 'NODE_VERSION_ERROR'
  | 'UNKNOWN_ERROR';

interface SuccessPayload {
  success: true;
  url: string;
  config_path: string;
  key_path: string;
  install_method: InstallMethod;
  node_name: string;
  thunderhub_directory?: string;
  post_install: string[];
}

interface ErrorPayload {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

type Payload = SuccessPayload | ErrorPayload;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emit(payload: Payload, exitCode: number): never {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  process.exit(exitCode);
}

function emitError(
  code: ErrorCode,
  message: string,
  options: { exitCode?: number; details?: Record<string, unknown> } = {},
): never {
  const { exitCode = 2, details } = options;
  emit({ success: false, error: { code, message, ...(details ? { details } : {}) } } as ErrorPayload, exitCode);
}

function printUsageAndExit(): never {
  process.stderr.write(
    `Usage: install_thunderhub.ts \\\n` +
      `  --goal <lnd|litd> \\\n` +
      `  --node-type <self-hosted|voltage> \\\n` +
      `  --server-url <host:port> \\\n` +
      `  --macaroon-path <path> \\\n` +
      `  --method <docker|source> \\\n` +
      `  [--tls-cert-path <path>] \\\n` +
      `  [--port <number>] \\\n` +
      `  [--output-dir <path>] \\\n` +
      `  [--node-name <name>]\\n`,
  );
  process.exit(1);
}

function resolvePath(p: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return resolve(p);
}

function generatePassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function checkDocker(): void {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 10_000 });
  } catch {
    emitError('DOCKER_NOT_FOUND', 'Docker is not available. Install Docker first: https://docs.docker.com/get-docker/');
  }
}

function checkNodeVersion(): void {
  try {
    const version = execSync('node --version', { encoding: 'utf-8', timeout: 5_000 }).trim();
    const major = Number.parseInt(version.replace(/^v/, '').split('.')[0], 10);
    if (major < REQUIRED_NODE_MAJOR) {
      emitError(
        'NODE_VERSION_ERROR',
        `Node.js v${REQUIRED_NODE_MAJOR}+ is required for ThunderHub source install. Current: ${version}. ` +
          `Upgrade Node.js or use the Docker install method instead.`,
        { exitCode: 1 },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitError('NODE_VERSION_ERROR', `Could not detect Node.js version: ${msg}`);
  }
}

function writeFiles(outputDir: string, configPath: string, keyPath: string, yaml: string, masterPassword: string): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(configPath, yaml, 'utf-8');
  writeFileSync(keyPath, masterPassword + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_GOALS = ['lnd', 'litd'] as const;
const VALID_NODE_TYPES = ['self-hosted', 'voltage'] as const;
const VALID_METHODS = ['docker', 'source'] as const;
const HOST_PORT_PATTERN = /^[\w.-]+:\d{1,5}$/;

function validateGoal(s: string): Goal {
  if (!VALID_GOALS.includes(s as Goal)) {
    emitError('VALIDATION_ERROR', `--goal must be one of: ${VALID_GOALS.join(', ')}`, { exitCode: 1 });
  }
  return s as Goal;
}

function validateNodeType(s: string): NodeType {
  if (!VALID_NODE_TYPES.includes(s as NodeType)) {
    emitError('VALIDATION_ERROR', `--node-type must be one of: ${VALID_NODE_TYPES.join(', ')}`, { exitCode: 1 });
  }
  return s as NodeType;
}

function validateMethod(s: string): InstallMethod {
  if (!VALID_METHODS.includes(s as InstallMethod)) {
    emitError('VALIDATION_ERROR', `--method must be one of: ${VALID_METHODS.join(', ')}`, { exitCode: 1 });
  }
  return s as InstallMethod;
}

function validateServerUrl(url: string): void {
  if (!HOST_PORT_PATTERN.test(url)) {
    emitError('VALIDATION_ERROR', '--server-url must be in format host:port (e.g. 127.0.0.1:10009)', { exitCode: 1 });
  }
  const portStr = url.split(':').pop()!;
  const port = Number.parseInt(portStr, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    emitError('VALIDATION_ERROR', 'Port in --server-url must be between 1 and 65535', { exitCode: 1 });
  }
}

function validateFileExists(path: string, label: string): void {
  const resolved = resolvePath(path);
  if (!existsSync(resolved)) {
    emitError('FILE_NOT_FOUND', `${label} not found at: ${resolved}`, { exitCode: 1 });
  }
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    emitError('VALIDATION_ERROR', '--port must be an integer between 1 and 65535', { exitCode: 1 });
  }
}

// ---------------------------------------------------------------------------
// Macaroon label helper
// ---------------------------------------------------------------------------

function macaroonLabel(goal: Goal): string {
  return goal === 'litd' ? 'superadmin macaroon' : 'admin macaroon';
}

// ---------------------------------------------------------------------------
// Config generation
// ---------------------------------------------------------------------------

function generateConfigYaml(opts: {
  goal: Goal;
  nodeType: NodeType;
  serverUrl: string;
  macaroonPath: string;
  tlsCertPath?: string;
  nodeName: string;
  method: InstallMethod;
}): string {
  const { goal, nodeType, serverUrl, macaroonPath, tlsCertPath, nodeName, method } = opts;
  const resolvedMacaroon = resolvePath(macaroonPath);

  // For Docker, paths inside container; for source, host filesystem paths
  const yamlMacaroonPath = method === 'docker'
    ? `/lnd-data/${macaroonPath.split('/').pop() || 'admin.macaroon'}`
    : resolvedMacaroon;

  const lines: string[] = [];
  lines.push('accounts:');
  lines.push(`  - name: "${nodeName}"`);

  if (goal === 'litd') {
    lines.push(`    accountType: "litd"`);
  } else {
    lines.push(`    accountType: "lnd"`);
  }

  lines.push(`    serverUrl: "${serverUrl}"`);
  lines.push(`    macaroonPath: "${yamlMacaroonPath}"`);

  if (tlsCertPath && nodeType !== 'voltage') {
    const resolvedCert = resolvePath(tlsCertPath);
    const yamlCertPath = method === 'docker'
      ? `/lnd-data/${tlsCertPath.split('/').pop() || 'tls.cert'}`
      : resolvedCert;
    lines.push(`    certificatePath: "${yamlCertPath}"`);
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Docker install
// ---------------------------------------------------------------------------

function installViaDocker(opts: {
  goal: Goal;
  nodeType: NodeType;
  serverUrl: string;
  macaroonPath: string;
  tlsCertPath?: string;
  nodeName: string;
  port: number;
  outputDir: string;
  masterPassword: string;
}): SuccessPayload {
  const { goal, nodeType, serverUrl, macaroonPath, tlsCertPath, nodeName, port, outputDir, masterPassword } = opts;

  checkDocker();

  const yaml = generateConfigYaml({
    goal, nodeType, serverUrl, macaroonPath, tlsCertPath, nodeName, method: 'docker',
  });
  const configPath = join(outputDir, 'thubConfig.yaml');
  const keyPath = join(outputDir, '.db_encryption_key');

  writeFiles(outputDir, configPath, keyPath, yaml, masterPassword);

  // Build volume mounts
  const volMacaroon = `${resolvePath(macaroonPath)}:/lnd-data/${macaroonPath.split('/').pop()}`;
  const volumes: string[] = [`-v ${volMacaroon}`];
  if (tlsCertPath && nodeType !== 'voltage') {
    volumes.push(`-v ${resolvePath(tlsCertPath)}:/lnd-data/${tlsCertPath.split('/').pop()}`);
  }

  const containerName = 'thunderhub';

  // Build docker run command
  let cmd = `docker rm -f ${containerName} 2>/dev/null; `;
  cmd += 'docker run -d \\\n';
  cmd += `  --name ${containerName} \\\n`;
  cmd += `  --restart unless-stopped \\\n`;
  cmd += `  -p ${port}:3000 \\\n`;
  cmd += `  -v ${configPath}:/app/thubConfig.yaml \\\n`;
  for (const vol of volumes) {
    cmd += `  ${vol} \\\n`;
  }
  cmd += `  -e ACCOUNT_CONFIG_PATH=/app/thubConfig.yaml \\\n`;
  cmd += `  -e DB_ENCRYPTION_KEY="${masterPassword}" \\\n`;
  cmd += `  ${DOCKER_IMAGE}`;

  // Run
  execSync(cmd, { stdio: 'pipe', timeout: 120_000, shell: '/bin/sh' });

  // Verify container is running
  const status = execSync('docker inspect thunderhub --format={{.State.Status}}', {
    encoding: 'utf-8',
    timeout: 10_000,
  }).trim();
  if (status !== 'running') {
    emitError('DOCKER_ERROR', `ThunderHub container status is "${status}", not "running". Check logs with: docker logs thunderhub`);
  }

  const url = port === 3000 ? 'http://localhost:3000' : `http://localhost:${port}`;

  const postInstall: string[] = [
    `ThunderHub is running at ${url}`,
    `Config file created at: ${configPath}`,
    `Encryption key saved to: ${keyPath} — BACK THIS UP. Without it, node credentials cannot be recovered.`,
    `On first visit, you will be prompted to create an admin account.`,
    `Add your node connection details in the web UI or edit ${configPath} directly.`,
    `To stop: docker stop thunderhub`,
    `To view logs: docker logs thunderhub`,
    `To restart after reboot (already configured with --restart unless-stopped)`,
  ];

  if (nodeType === 'voltage') {
    postInstall.push('Voltage nodes use CA-signed certificates — no TLS config needed.');
  }

  if (goal === 'litd' && nodeType === 'self-hosted') {
    postInstall.push(
      'For Taproot Assets trading, configure a price oracle in your lit.conf:\n' +
      '  taproot-assets.experimental.rfq.priceoracleaddress=rfqrpc://price-oracle.amboss.tech:443',
    );
  }

  return { success: true, url, config_path: configPath, key_path: keyPath, install_method: 'docker', node_name: nodeName, post_install: postInstall };
}

// ---------------------------------------------------------------------------
// Source install
// ---------------------------------------------------------------------------

function installViaSource(opts: {
  goal: Goal;
  nodeType: NodeType;
  serverUrl: string;
  macaroonPath: string;
  tlsCertPath?: string;
  nodeName: string;
  port: number;
  outputDir: string;
  masterPassword: string;
}): SuccessPayload {
  const { goal, nodeType, serverUrl, macaroonPath, tlsCertPath, nodeName, port, outputDir, masterPassword } = opts;

  checkNodeVersion();

  const yaml = generateConfigYaml({
    goal, nodeType, serverUrl, macaroonPath, tlsCertPath, nodeName, method: 'source',
  });
  const configPath = join(outputDir, 'thubConfig.yaml');
  const keyPath = join(outputDir, '.db_encryption_key');

  writeFiles(outputDir, configPath, keyPath, yaml, masterPassword);

  // Determine install directory
  const installDir = join(outputDir, 'thunderhub-app');

  // Clone repo
  process.stderr.write('Cloning ThunderHub repository...\n');
  execSync(`git clone --depth=1 ${THUNDERHUB_REPO} "${installDir}"`, {
    stdio: 'pipe', timeout: 120_000,
  });

  // Install dependencies
  process.stderr.write('Installing dependencies...\n');
  execSync('npm install', { cwd: installDir, stdio: 'pipe', timeout: 180_000 });

  // Build
  process.stderr.write('Building ThunderHub...\n');
  execSync('npm run build', { cwd: installDir, stdio: 'pipe', timeout: 180_000 });

  // Copy config into the install directory
  const appConfigPath = join(installDir, 'thubConfig.yaml');
  writeFileSync(appConfigPath, yaml, 'utf-8');

  // Determine the start command
  const envPort = port !== 3000 ? `PORT=${port} ` : '';

  const url = port === 3000 ? 'http://localhost:3000' : `http://localhost:${port}`;

  const postInstall: string[] = [
    `ThunderHub installed at: ${installDir}`,
    `Config file created at: ${appConfigPath}`,
    `Encryption key saved to: ${keyPath} — BACK THIS UP. Without it, node credentials cannot be recovered.`,
    ``,
    `To start ThunderHub:`,
    `  cd "${installDir}"`,
    `  ${envPort}ACCOUNT_CONFIG_PATH=thubConfig.yaml DB_ENCRYPTION_KEY="${masterPassword}" npm start`,
    ``,
    `Once started, access it at ${url}`,
    `On first visit, you will be prompted to create an admin account.`,
  ];

  if (nodeType === 'voltage') {
    postInstall.push('Voltage nodes use CA-signed certificates — no TLS config needed.');
  }

  if (goal === 'litd' && nodeType === 'self-hosted') {
    postInstall.push(
      'For Taproot Assets trading, configure a price oracle in your lit.conf:\n' +
      '  taproot-assets.experimental.rfq.priceoracleaddress=rfqrpc://price-oracle.amboss.tech:443',
    );
  }

  return { success: true, url, config_path: appConfigPath, key_path: keyPath, install_method: 'source', node_name: nodeName, thunderhub_directory: installDir, post_install: postInstall };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      options: {
        goal: { type: 'string' },
        'node-type': { type: 'string' },
        'server-url': { type: 'string' },
        'macaroon-path': { type: 'string' },
        'tls-cert-path': { type: 'string' },
        method: { type: 'string' },
        port: { type: 'string', default: '3000' },
        'output-dir': { type: 'string' },
        'node-name': { type: 'string', default: 'My Lightning Node' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Argument error: ${msg}\n`);
    printUsageAndExit();
  }

  if (values.help) printUsageAndExit();

  const goalRaw = values.goal as string | undefined;
  const nodeTypeRaw = values['node-type'] as string | undefined;
  const serverUrl = values['server-url'] as string | undefined;
  const macaroonPath = values['macaroon-path'] as string | undefined;
  const tlsCertPath = values['tls-cert-path'] as string | undefined;
  const methodRaw = (values.method as string) ?? 'docker';
  const portStr = (values.port as string) ?? '3000';
  const outputDirRaw = (values['output-dir'] as string) ?? '.';
  const nodeName = (values['node-name'] as string) ?? 'My Lightning Node';

  // Validate required args
  if (!goalRaw || !nodeTypeRaw || !serverUrl || !macaroonPath) {
    process.stderr.write('Error: --goal, --node-type, --server-url, and --macaroon-path are required\n');
    printUsageAndExit();
  }

  // Parse & validate
  const goal = validateGoal(goalRaw);
  const nodeType = validateNodeType(nodeTypeRaw);
  const method = validateMethod(methodRaw);
  const port = Number.parseInt(portStr, 10);
  validatePort(port);
  validateServerUrl(serverUrl);

  // Resolve output dir
  const outputDir = resolve(outputDirRaw);

  // Validate file paths — for litd, we require a superadmin macaroon
  const macLabel = macaroonLabel(goal);
  validateFileExists(macaroonPath, macLabel);
  if (tlsCertPath && nodeType !== 'voltage') {
    validateFileExists(tlsCertPath, 'TLS certificate file');
  }

  // Generate master password for DB encryption
  const masterPassword = generatePassword();

  // Run the install
  const result = method === 'docker'
    ? installViaDocker({ goal, nodeType, serverUrl, macaroonPath, tlsCertPath, nodeName, port, outputDir, masterPassword })
    : installViaSource({ goal, nodeType, serverUrl, macaroonPath, tlsCertPath, nodeName, port, outputDir, masterPassword });

  emit(result, 0);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  emitError('UNKNOWN_ERROR', msg);
});
