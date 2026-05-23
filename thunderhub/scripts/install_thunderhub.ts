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
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { homedir, platform, arch } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { createConnection } from 'node:net';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THUNDERHUB_REPO = 'https://github.com/apotdevin/thunderhub.git';
const DOCKER_IMAGE = 'apotdevin/thunderhub:latest';
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
      `  [--node-name <name>] \\\n` +
      `  [--setup-litd]       Download and configure a new litd node (skips --server-url, --macaroon-path, --tls-cert-path)\\n`,
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
// Interactive prompt
// ---------------------------------------------------------------------------

async function promptUser(question: string, defaultValue?: string): Promise<string> {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      rl.close();
      res(answer.trim() || defaultValue || '');
    });
  });
}

async function promptYesNo(question: string): Promise<boolean> {
  const answer = await promptUser(`${question} (y/N)`, 'n');
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
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
// litd setup (download, verify, configure with neutrino)
// ---------------------------------------------------------------------------

interface LitdNodeInfo {
  serverUrl: string;
  macaroonPath: string;
  tlsCertPath: string;
  lndDir: string;
  walletPassword: string;
}

function detectPlatform(): { os: string; arch: string } {
  const osMap: Record<string, string> = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
  const archMap: Record<string, string> = { x64: 'amd64', arm64: 'arm64' };
  const detectedOs = osMap[platform()];
  const detectedArch = archMap[arch()];
  if (!detectedOs) emitError('INSTALL_ERROR', `Unsupported OS: ${platform()}`);
  if (!detectedArch) emitError('INSTALL_ERROR', `Unsupported architecture: ${arch()}`);
  return { os: detectedOs!, arch: detectedArch! };
}

async function fetchLatestLitdVersion(): Promise<string> {
  process.stderr.write('Fetching latest litd release info...\n');
  const res = await fetch('https://api.github.com/repos/lightninglabs/lightning-terminal/releases/latest', {
    headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'thunderhub-skill/1.0' },
  });
  if (!res.ok) {
    emitError('INSTALL_ERROR', `Failed to fetch latest litd release: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { tag_name?: string };
  const tag = data.tag_name;
  if (!tag) emitError('INSTALL_ERROR', 'Could not determine latest litd version from GitHub API');
  process.stderr.write(`Latest litd release: ${tag}\n`);
  return tag!;
}

function sha256sum(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function waitForPort(port: number, host: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function tryConnect(): void {
      const socket = createConnection(port, host, () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`Timeout waiting for ${host}:${port} to become available`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
    }
    tryConnect();
  });
}

async function downloadFile(url: string, dest: string): Promise<void> {
  process.stderr.write(`Downloading ${basename(url)}...\n`);
  const res = await fetch(url);
  if (!res.ok) {
    emitError('INSTALL_ERROR', `Failed to download ${basename(url)}: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buffer);
  process.stderr.write(`Downloaded to ${dest}\n`);
}

async function setupLitdNode(): Promise<LitdNodeInfo> {
  process.stderr.write('\n=== litd Node Setup ===\n\n');

  // Ask user for confirmation
  const confirmed = await promptYesNo(
    'No existing Lightning node detected. Would you like to download and set up a new litd node?',
  );
  if (!confirmed) {
    emitError('INSTALL_ERROR', 'User declined litd node setup. Provide --server-url and --macaroon-path for an existing node.');
  }

  // Ask for node alias and UI password
  const alias = await promptUser('Enter a name for your node', 'My Lightning Node');
  const uiPasswordInput = await promptUser(
    'Enter a UI password for litd (leave blank to auto-generate)',
  );
  const uiPassword = uiPasswordInput || generatePassword();

  // Detect platform
  const { os, arch: cpuArch } = detectPlatform();
  process.stderr.write(`Platform: ${os} ${cpuArch}\n`);

  // Fetch latest litd version
  const version = await fetchLatestLitdVersion();

  // Download directory
  const downloadDir = join(homedir(), '.lit', '.download');
  mkdirSync(downloadDir, { recursive: true });

  // Construct URLs
  const binaryUrl = `https://github.com/lightninglabs/lightning-terminal/releases/download/${version}/lightning-terminal-${os}-${cpuArch}-${version}.tar.gz`;
  const manifestUrl = `https://github.com/lightninglabs/lightning-terminal/releases/download/${version}/manifest-${version}.txt`;
  const manifestSigUrl = `https://github.com/lightninglabs/lightning-terminal/releases/download/${version}/manifest-${version}.txt.sig`;

  const tarballPath = join(downloadDir, `lightning-terminal-${os}-${cpuArch}-${version}.tar.gz`);
  const manifestPath = join(downloadDir, `manifest-${version}.txt`);
  const sigPath = join(downloadDir, `manifest-${version}.txt.sig`);

  // Download files
  await downloadFile(binaryUrl, tarballPath);

  // Try downloading manifest and signature (may not exist for all releases)
  let manifestVerified = false;
  let manifestText = '';
  try {
    await downloadFile(manifestUrl, manifestPath);
    manifestText = readFileSync(manifestPath, 'utf-8');

    // SHA256 verification
    const hash = sha256sum(tarballPath);
    const expectedLine = manifestText.split('\n').find((line) => line.includes(basename(binaryUrl)));
    if (expectedLine) {
      const expectedHash = expectedLine.split(/\s+/)[0];
      if (hash === expectedHash) {
        process.stderr.write('SHA256 verification: PASSED\n');
        manifestVerified = true;
      } else {
        process.stderr.write(`SHA256 verification: FAILED (expected ${expectedHash}, got ${hash})\n`);
      }
    } else {
      process.stderr.write('Warning: binary not found in manifest, skipping SHA256 verification\n');
    }

    // Try PGP verification if gpg is available
    try {
      await downloadFile(manifestSigUrl, sigPath);
      execSync(
        `gpg --verify "${sigPath}" "${manifestPath}" 2>/dev/null`,
        { stdio: 'pipe', timeout: 15_000 },
      );
      process.stderr.write('PGP signature verification: PASSED\n');
    } catch {
      process.stderr.write('PGP signature verification skipped (gpg not available or no trusted key)\n');
    }
  } catch {
    process.stderr.write('Warning: could not download manifest/signature files. Skipping verification.\n');
  }

  if (!manifestVerified) {
    process.stderr.write('Warning: binary was not cryptographically verified. Proceed with caution.\n');
  }

  // Extract tarball
  process.stderr.write('Extracting litd binary...\n');
  const extractDir = join(downloadDir, 'extracted');
  mkdirSync(extractDir, { recursive: true });

  execSync(`tar -xzf "${tarballPath}" -C "${extractDir}" --strip-components=1 2>/dev/null`, {
    stdio: 'pipe',
    timeout: 30_000,
  });

  // Determine install directory
  const litBinDir = join(homedir(), '.lit', 'bin');
  mkdirSync(litBinDir, { recursive: true });

  // Move binaries
  const binDir = join(extractDir);
  const binaries = ['litd', 'lncli', 'lit-loop', 'lit-pool'];
  for (const bin of binaries) {
    const src = join(binDir, bin);
    if (existsSync(src)) {
      const dest = join(litBinDir, bin);
      const destContent = readFileSync(src);
      writeFileSync(dest, destContent);
      chmodSync(dest, 0o755);
      process.stderr.write(`Installed ${bin} to ${dest}\n`);
    }
  }

  // Create symlink or add to PATH note
  const litDir = join(homedir(), '.lit');
  const lndDir = join(homedir(), '.lnd');
  const litConfPath = join(litDir, 'lit.conf');
  const walletPasswordPath = join(lndDir, 'wallet_password');

  // Create directories
  mkdirSync(litDir, { recursive: true });
  mkdirSync(lndDir, { recursive: true });

  // Generate wallet password
  const walletPassword = generatePassword();
  writeFileSync(walletPasswordPath, walletPassword + '\n');
  process.stderr.write(`Wallet password saved to ${walletPasswordPath}\n`);

  // Generate lit.conf with neutrino backend
  const litConfLines = [
    '# litd Configuration (auto-generated by ThunderHub skill)',
    `# Network`,
    `network=mainnet`,
    '',
    '# litd Settings',
    'lnd-mode=integrated',
    'enablerest=true',
    'httpslisten=0.0.0.0:8443',
    `uipassword=${uiPassword}`,
    '',
    '# Bitcoin - Neutrino (light client) backend',
    'lnd.bitcoin.active=1',
    'lnd.bitcoin.node=neutrino',
    '',
    '# Neutrino peers',
    'lnd.neutrino.connect=neu1.btcpayserver.org',
    'lnd.neutrino.connect=node.lightning.engineering',
    '',
    '# Fee estimation',
    'lnd.neutrino.feeurl=https://nodes.lightning.computer/fees/v1/btc-fee-estimates.json',
    '',
    '# LND Settings',
    `lnd.debuglevel=info`,
    `lnd.alias=${alias}`,
    'lnd.maxpendingchannels=3',
    'lnd.accept-keysend=true',
    'lnd.accept-amp=true',
    'lnd.rpcmiddleware.enable=true',
    'lnd.autopilot.active=0',
    '',
    '# Wallet unlock',
    `lnd.wallet-unlock-password-file=${walletPasswordPath}`,
    'lnd.wallet-unlock-allow-create=true',
    '',
    '# Protocol Settings',
    'lnd.protocol.simple-taproot-chans=true',
    'lnd.protocol.simple-taproot-overlay-chans=true',
    'lnd.protocol.option-scid-alias=true',
    'lnd.protocol.zero-conf=true',
    'lnd.protocol.custom-message=17',
    '',
    '# Disable Loop/Pool by default (enable via command line if needed)',
    'loop-mode=disable',
    'pool-mode=disable',
  ];
  writeFileSync(litConfPath, litConfLines.join('\n') + '\n');
  process.stderr.write(`Configuration written to ${litConfPath}\n`);

  // Expected macaroon and TLS cert paths after first run
  const macaroonPath = join(lndDir, 'data', 'chain', 'bitcoin', 'mainnet', 'admin.macaroon');
  const tlsCertPath = join(lndDir, 'tls.cert');

  const litdBinary = join(litBinDir, 'litd');
  const lncliBinary = join(litBinDir, 'lncli');
  if (!existsSync(litdBinary)) {
    emitError('INSTALL_ERROR', `litd binary not found at ${litdBinary}. Extraction may have failed.`);
  }

  const endpoint = '127.0.0.1:8443';
  const lndRpcPort = 10009;
  let seedMnemonic: string[] | undefined;
  let walletCreated = false;

  // -------------------------------------------------------------------
  // Auto-create the wallet (non-interactive via spawned lncli)
  // -------------------------------------------------------------------
  process.stderr.write('\nStarting litd to initialize the node...\n');

  try {
    // Start litd in background
    const litdProcess = spawn(litdBinary, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME: homedir() },
    });

    // Forward litd stderr so the user can see progress
    litdProcess.stderr?.on('data', (d: Buffer) => process.stderr.write(d.toString()));

    // Wait for the LND RPC port to be ready (wallet unlocker mode)
    process.stderr.write('Waiting for litd to be ready...\n');
    await waitForPort(lndRpcPort, '127.0.0.1', 60_000);
    // Give LND a moment to fully initialize its wallet unlocker RPC subsystem
    await new Promise((r) => setTimeout(r, 2000));
    process.stderr.write('litd is ready. Creating wallet...\n');

    // Create wallet via lncli with piped responses:
    //   1. password (for "Input wallet password:")
    //   2. password again (for "Confirm wallet password:")
    //   3. "n" (for "Do you have an existing seed?")
    //   4. "y" (for "You have backed up your seed?")
    const lncli = spawn(lncliBinary, ['--network=mainnet', 'create'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: homedir() },
    });

    let lncliOutput = '';
    lncli.stdout?.on('data', (d: Buffer) => {
      const text = d.toString();
      lncliOutput += text;
      process.stderr.write(text); // forward so user sees prompts
    });
    lncli.stderr?.on('data', (d: Buffer) => {
      const text = d.toString();
      lncliOutput += text;
      process.stderr.write(text);
    });

    // Pipe responses: password, confirm password, new seed, confirm backup
    // stdin buffering handles the sequencing — lncli reads line-by-line
    lncli.stdin?.write(`${walletPassword}\n`);
    lncli.stdin?.write(`${walletPassword}\n`);
    lncli.stdin?.write('n\n');
    lncli.stdin?.write('y\n');
    lncli.stdin?.end();

    // Wait for lncli to finish
    const lncliExitCode = await new Promise<number | null>((resolve) => {
      lncli.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 30_000);
    });

    if (lncliExitCode === 0) {
      walletCreated = true;
      // Extract seed from lncli output.
      // LND shows the seed as 24 BIP39 words after "Your wallet mnemonic seed is:"
      const seedSection = lncliOutput.match(
        /(?:wallet\s+mnemonic\s+seed|seed\s+words|mnemonic)[^]*?\n((?:[a-z]+\n?){24})/i,
      );
      if (seedSection) {
        seedMnemonic = seedSection[1].trim().split(/\s+/);
        if (seedMnemonic.length !== 24) seedMnemonic = undefined;
      }
    } else {
      process.stderr.write(`lncli create exited with code ${lncliExitCode}. Output captured above.\n`);
    }

    // Stop litd gracefully and wait for it to exit
    const litdExit = new Promise<void>((resolve) => {
      litdProcess.on('exit', () => resolve());
    });
    litdProcess.kill('SIGTERM');
    await Promise.race([litdExit, new Promise((r) => setTimeout(r, 5000))]);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\nWarning: automatic wallet creation failed: ${msg}\n`);
    process.stderr.write('Proceeding with manual instructions.\n');
    walletCreated = false;
  }

  // Compose post-install output
  const pathNote = `Add ${litBinDir} to your PATH or run: export PATH="${litBinDir}:$PATH"`;
  const instructions: string[] = [
    '',
    '=== litd Setup Complete ===',
    '',
    `Binary directory: ${litBinDir}`,
    `Configuration: ${litConfPath}`,
    `Wallet password: ${walletPasswordPath}`,
    '',
    pathNote,
  ];

  if (walletCreated && seedMnemonic && seedMnemonic.length === 24) {
    instructions.push('', '✓ Wallet created automatically!');
    instructions.push('', '*** YOUR WALLET SEED (BACK THIS UP!): ***');
    instructions.push('');
    // Display in groups of 6 for readability
    for (let i = 0; i < 24; i += 6) {
      instructions.push(`  ${seedMnemonic.slice(i, i + 6).join('  ')}`);
    }
    instructions.push('');
    instructions.push('!!! WRITE DOWN THESE 24 WORDS AND KEEP THEM SAFE !!!');
    instructions.push('!!! WITHOUT THE SEED, YOU CANNOT RECOVER YOUR FUNDS !!!');
    instructions.push('');
    instructions.push('The wallet will auto-unlock on next start.');
    instructions.push('');
    instructions.push('Next steps:');
    instructions.push(`  1. Start litd: ${litdBinary}`);
    instructions.push('  2. Access the litd UI at https://localhost:8443');
    instructions.push('  3. ThunderHub can now connect to this node');
  } else {
    instructions.push('');
    instructions.push('Manual wallet creation required:');
    instructions.push(`  ${pathNote}`);
    instructions.push(`  lncli --network=mainnet create`);
    instructions.push(`  (use password from: cat ${walletPasswordPath})`);
    instructions.push('');
    instructions.push('IMPORTANT: BACKUP YOUR WALLET SEED WORDS!');
    instructions.push('');
    if (walletCreated && (!seedMnemonic || seedMnemonic.length !== 24)) {
      instructions.push('(Wallet was created but seed could not be extracted from output.)');
      instructions.push('Check the output above for your seed words.');
    }
  }

  process.stderr.write(instructions.join('\n') + '\n');

  // Check if macaroon exists now
  if (existsSync(macaroonPath)) {
    process.stderr.write(`\n✓ Macaroon found at: ${macaroonPath}\n`);
  } else {
    process.stderr.write(`\nNote: ${macaroonPath} not yet created. ` +
      'The macaroon file will be created once you start litd and create the wallet.\n');
  }

  // Cleanup download artifacts
  try {
    rmSync(downloadDir, { recursive: true, force: true });
  } catch {
    // non-critical cleanup
  }

  return {
    serverUrl: endpoint,
    macaroonPath,
    tlsCertPath,
    lndDir,
    walletPassword,
  };
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
        'setup-litd': { type: 'boolean', default: false },
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
  let serverUrl = values['server-url'] as string | undefined;
  let macaroonPath = values['macaroon-path'] as string | undefined;
  let tlsCertPath = values['tls-cert-path'] as string | undefined;
  const methodRaw = (values.method as string) ?? 'docker';
  const portStr = (values.port as string) ?? '3000';
  const outputDirRaw = (values['output-dir'] as string) ?? '.';
  const nodeName = (values['node-name'] as string) ?? 'My Lightning Node';
  const setupLitd = Boolean(values['setup-litd']);

  // Parse & validate basic args
  if (!goalRaw) {
    process.stderr.write('Error: --goal is required\n');
    printUsageAndExit();
  }
  const goal = validateGoal(goalRaw);

  if (!nodeTypeRaw) {
    process.stderr.write('Error: --node-type is required\n');
    printUsageAndExit();
  }
  const nodeType = validateNodeType(nodeTypeRaw);

  if (!setupLitd) {
    // Normal mode: require server-url and macaroon-path
    if (!serverUrl || !macaroonPath) {
      process.stderr.write('Error: --server-url and --macaroon-path are required (use --setup-litd to auto-configure a node)\n');
      printUsageAndExit();
    }
  }

  const method = validateMethod(methodRaw);
  const port = Number.parseInt(portStr, 10);
  validatePort(port);

  // If --setup-litd, install and configure a new litd node first
  let litdInfo: LitdNodeInfo | undefined;
  if (setupLitd) {
    process.stderr.write('\nSetting up a new litd node (with Neutrino backend)...\n');
    litdInfo = await setupLitdNode();
    serverUrl = litdInfo.serverUrl;
    macaroonPath = litdInfo.macaroonPath;
    tlsCertPath = litdInfo.tlsCertPath;
  }

  // Validate server URL
  validateServerUrl(serverUrl!);

  // Resolve output dir
  const outputDir = resolve(outputDirRaw);

  // Validate file paths — for litd, we require a superadmin macaroon
  // (skip if we just set up litd, as files may not exist until wallet is created)
  if (!setupLitd) {
    const macLabel = macaroonLabel(goal);
    validateFileExists(macaroonPath!, macLabel);
    if (tlsCertPath && nodeType !== 'voltage') {
      validateFileExists(tlsCertPath, 'TLS certificate file');
    }
  }

  // Generate master password for DB encryption
  const masterPassword = generatePassword();

  // Run the install
  const result = method === 'docker'
    ? installViaDocker({ goal, nodeType, serverUrl: serverUrl!, macaroonPath: macaroonPath!, tlsCertPath, nodeName, port, outputDir, masterPassword })
    : installViaSource({ goal, nodeType, serverUrl: serverUrl!, macaroonPath: macaroonPath!, tlsCertPath, nodeName, port, outputDir, masterPassword });

  emit(result, 0);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  emitError('UNKNOWN_ERROR', msg);
});
