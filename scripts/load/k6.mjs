#!/usr/bin/env node
/**
 * Runs a k6 scenario from this folder in the grafana/k6 Docker image (no local k6 install needed):
 *
 *   node scripts/load/k6.mjs <scenario> [k6 run arguments…]     e.g. gate-scanning -e DURATION=1m
 *   node scripts/load/k6.mjs inspect [scenario…]                 validate scripts (all when none named)
 *
 * The folder is mounted read-only at /scripts (the fixture from setup.mjs included). BASE_URL is passed
 * through from the environment; it must be reachable from inside the container: host.docker.internal
 * for a stack published on this computer, or set K6_NETWORK=<docker network> and use the API container's
 * name. K6_IMAGE overrides the image (default grafana/k6:latest; tested with k6 v2.3.0). The end-of-test
 * summary is also written to .fixture/<scenario>-summary.json.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const IMAGE = process.env.K6_IMAGE ?? 'grafana/k6:latest';
const SCENARIOS = ['otp-burst', 'reservation-burst', 'gate-scanning', 'sync-backlog'];
const [command, ...rest] = process.argv.slice(2);

const docker = (args, { mountWritable = false } = {}) => {
  const network = process.env.K6_NETWORK ? ['--network', process.env.K6_NETWORK] : [];
  const env = ['BASE_URL', 'INSECURE_TLS'].flatMap((name) => (process.env[name] ? ['-e', `${name}=${process.env[name]}`] : []));
  // The summary export needs a writable .fixture/; everything else stays read-only.
  const mounts = ['-v', `${here}:/scripts:ro`, ...(mountWritable ? ['-v', `${resolve(here, '.fixture')}:/scripts/.fixture`] : [])];
  return run('docker', ['run', '--rm', '-i', ...network, '--add-host', 'host.docker.internal:host-gateway', ...mounts, '-w', '/scripts', ...env, IMAGE, ...args], {
    allowFail: true,
    stdio: 'inherit',
  }).status;
};

if (command === 'inspect') {
  let failed = 0;
  for (const name of rest.length ? rest : SCENARIOS) {
    console.log(`== k6 inspect ${name}.js`);
    // Retry: the first pull of the image can time out on a slow registry connection.
    let status = 1;
    for (let attempt = 0; attempt < 3 && status !== 0; attempt++) status = docker(['inspect', `/scripts/${name}.js`]);
    if (status !== 0) failed++;
  }
  process.exitCode = failed ? 1 : 0;
} else if (SCENARIOS.includes(command)) {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(resolve(here, '.fixture'), { recursive: true });
  process.exitCode = docker(['run', `--summary-export=/scripts/.fixture/${command}-summary.json`, ...rest, `/scripts/${command}.js`], {
    mountWritable: true,
  });
} else {
  console.error(`usage: node scripts/load/k6.mjs <${SCENARIOS.join('|')}> [k6 args…] | inspect [scenario…]`);
  process.exitCode = 2;
}
