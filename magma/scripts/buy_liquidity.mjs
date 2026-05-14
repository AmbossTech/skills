#!/usr/bin/env node
/**
 * Buy inbound Lightning Network liquidity via the Amboss Magma GraphQL API.
 *
 * Uses only Node.js built-in modules — no `npm install` required.
 * Requires Node.js >= 18 (for built-in fetch).
 *
 * Environment variables:
 *   MAGMA_API_KEY            Optional. Amboss Magma API key. If unset,
 *                            the API creates a temporary anonymous account.
 *   MAGMA_GRAPHQL_ENDPOINT   Optional. Defaults to the production endpoint.
 *
 * Exit codes:
 *   0  success
 *   1  validation error (bad input)
 *   2  API / network error
 *
 * Output: JSON to stdout. See README for the schema.
 */

import { parseArgs } from 'node:util';

const DEFAULT_ENDPOINT = 'https://magma.amboss.tech/graphql';
const CLIENT_NAME = 'magma-skill';
const CLIENT_VERSION = '1.0.0';
const MIN_USD_CENTS = 500;
const PUBKEY_PATTERN = /^[0-9a-f]{66}(@[\w.\-]+:\d{1,5})?$/i;

const BUY_LIQUIDITY_MUTATION = `
  mutation BuyLiquidity($input: LiquidityOrderInput!) {
    liquidity {
      buy(input: $input) {
        payment {
          lightning_invoice
        }
      }
    }
  }
`;

function emit(payload, exitCode) {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  process.exit(exitCode);
}

function emitError(code, message, { exitCode = 2, details } = {}) {
  const payload = { success: false, error: { code, message } };
  if (details) payload.error.details = details;
  emit(payload, exitCode);
}

function validateConnectionUri(uri) {
  if (!PUBKEY_PATTERN.test(uri)) {
    emitError(
      'VALIDATION_ERROR',
      'Connection URI must be a 66-character pubkey or pubkey@host:port',
      { exitCode: 1 }
    );
  }
  if (uri.includes('@')) {
    const portStr = uri.split(':').pop();
    const port = Number.parseInt(portStr, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      emitError('VALIDATION_ERROR', 'Port must be between 1 and 65535', { exitCode: 1 });
    }
  }
}

function validateUsdCents(cents) {
  if (!Number.isInteger(cents)) {
    emitError('VALIDATION_ERROR', 'Amount must be a whole number of cents', { exitCode: 1 });
  }
  if (cents < MIN_USD_CENTS) {
    emitError(
      'VALIDATION_ERROR',
      `Minimum purchase amount is $${(MIN_USD_CENTS / 100).toFixed(2)} (${MIN_USD_CENTS} cents)`,
      { exitCode: 1 }
    );
  }
}

function isRetriable(status, err) {
  if (status != null && (status >= 500 || status === 429)) return true;
  if (err && (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND' || err.code === 'UND_ERR_CONNECT_TIMEOUT')) {
    return true;
  }
  return false;
}

function clientErrorMessage(status, bodyText) {
  const messages = {
    401: 'Authentication failed. If you set MAGMA_API_KEY, verify it at https://account.amboss.tech/settings/api-keys. Unset it to use anonymous access.',
    403: 'Access forbidden. Your API key may lack the required permissions.',
    404: 'API endpoint not found. Check MAGMA_GRAPHQL_ENDPOINT.',
    429: 'Rate limit exceeded. Try again shortly.',
  };
  if (messages[status]) return messages[status];
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      return `Request failed: ${parsed.errors[0].message || 'Invalid request'}`;
    }
  } catch {
    /* ignore */
  }
  return `Magma API returned HTTP ${status}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callApi(endpoint, apiKey, variables, maxRetries = 2) {
  const headers = {
    'Content-Type': 'application/json',
    'apollographql-client-name': CLIENT_NAME,
    'apollographql-client-version': CLIENT_VERSION,
  };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const body = JSON.stringify({ query: BUY_LIQUIDITY_MUTATION, variables });

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(endpoint, { method: 'POST', headers, body });
      const text = await response.text();
      if (!response.ok) {
        if (attempt < maxRetries && isRetriable(response.status, null)) {
          await sleep((attempt + 1) * 1000);
          continue;
        }
        emitError('HTTP_ERROR', clientErrorMessage(response.status, text), {
          details: { status: response.status },
        });
      }
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        emitError('UNKNOWN_ERROR', 'Magma API returned a non-JSON response');
      }
      if (payload.errors && payload.errors.length > 0) {
        const msg = payload.errors[0]?.message || 'GraphQL error';
        emitError('API_ERROR', `Magma API rejected the request: ${msg}`);
      }
      return payload.data;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries && isRetriable(null, err)) {
        await sleep((attempt + 1) * 1000);
        continue;
      }
      emitError('NETWORK_ERROR', `Could not reach the Magma API: ${err.message || err}`);
    }
  }
  emitError('UNKNOWN_ERROR', `Request failed after retries: ${lastErr?.message || lastErr}`);
}

function printUsageAndExit() {
  process.stderr.write(
    `Usage: buy_liquidity.mjs --connection-uri <pubkey[@host:port]> --usd-cents <int> ` +
      `[--redirect-url <url>] [--private-channel] [--rails-cluster-only]\n`
  );
  process.exit(1);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        'connection-uri': { type: 'string' },
        'usd-cents': { type: 'string' },
        'redirect-url': { type: 'string' },
        'private-channel': { type: 'boolean', default: false },
        'rails-cluster-only': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
    });
  } catch (err) {
    process.stderr.write(`Argument error: ${err.message}\n`);
    printUsageAndExit();
  }

  const { values } = parsed;
  if (values.help) printUsageAndExit();

  const connectionUri = values['connection-uri'];
  const usdCentsStr = values['usd-cents'];

  if (!connectionUri || !usdCentsStr) {
    process.stderr.write('Error: --connection-uri and --usd-cents are required\n');
    printUsageAndExit();
  }

  const usdCents = Number.parseInt(usdCentsStr, 10);
  if (Number.isNaN(usdCents)) {
    emitError('VALIDATION_ERROR', '--usd-cents must be an integer', { exitCode: 1 });
  }

  validateConnectionUri(connectionUri);
  validateUsdCents(usdCents);

  const endpoint = process.env.MAGMA_GRAPHQL_ENDPOINT || DEFAULT_ENDPOINT;
  const apiKey = process.env.MAGMA_API_KEY;

  const input = {
    connection_uri: connectionUri,
    usd_cents: String(usdCents),
    options: {
      private: values['private-channel'],
      rails_cluster_only: values['rails-cluster-only'],
    },
  };
  if (values['redirect-url']) input.redirect_url = values['redirect-url'];

  const data = await callApi(endpoint, apiKey, { input });

  const invoice = data?.liquidity?.buy?.payment?.lightning_invoice;
  if (!invoice) {
    emitError('UNKNOWN_ERROR', 'Magma API response missing lightning_invoice', {
      details: { raw: data },
    });
  }

  emit({ success: true, lightning_invoice: invoice }, 0);
}

main().catch((err) => {
  emitError('UNKNOWN_ERROR', err?.message || String(err));
});
