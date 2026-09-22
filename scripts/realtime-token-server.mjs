/* global console, fetch, process */
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';

const envFiles = ['.env.local', '.env'];

const loadEnvFile = (path) => {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || process.env[key] !== undefined) continue;
    const value = rawValue?.replace(/^['"]|['"]$/g, '') ?? '';
    process.env[key] = value;
  }
};

envFiles.forEach(loadEnvFile);

const host = process.env.REALTIME_TOKEN_HOST ?? '127.0.0.1';
const port = Number(process.env.REALTIME_TOKEN_PORT ?? 8787);
const openAIKey =
  process.env.OPENAI_API_KEY ??
  process.env.OPENAI_KEY ??
  process.env.VITE_OPENAI_API_KEY ??
  process.env.VITE_OPENAI_KEY;

const json = (response, status, body) => {
  response.writeHead(status, {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(body));
};

const bodyText = (request) =>
  new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 20_000) reject(new Error('Request body too large'));
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    json(response, 204, {});
    return;
  }

  if (request.method !== 'POST' || request.url !== '/realtime/client-secret') {
    json(response, 404, { error: 'Not found' });
    return;
  }

  if (!openAIKey) {
    json(response, 500, { error: 'OPENAI_API_KEY is required' });
    return;
  }

  try {
    const parsed = JSON.parse(await bodyText(request) || '{}');
    const model = typeof parsed.model === 'string' ? parsed.model : 'gpt-realtime';
    const voice = typeof parsed.voice === 'string' ? parsed.voice : 'shimmer';

    const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAIKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model,
          audio: { output: { voice } },
        },
      }),
    });

    const upstreamText = await upstream.text();
    if (!upstream.ok) {
      json(response, upstream.status, { error: upstreamText });
      return;
    }

    const data = JSON.parse(upstreamText);
    json(response, 200, { clientSecret: data.value });
  } catch (error) {
    json(response, 500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

server.listen(port, host, () => {
  console.log(`Realtime token server listening at http://${host}:${port}`);
});
