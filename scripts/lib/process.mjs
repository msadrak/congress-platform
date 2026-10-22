/**
 * The one place scripts spawn processes.
 *
 * - `run` never goes through a shell, except for Windows batch shims (npm, npx, *.cmd, *.bat), which
 *   Node can only start through cmd.exe. Those get every argument quoted and caret-escaped, so spaces
 *   (the repo path has them) and cmd metacharacters reach the program unchanged.
 * - `freePort` / `freePorts` hand out currently free 127.0.0.1 ports so disposable stacks never collide
 *   with other worktrees or the local demo API.
 * - `startPreview` serves web/dist with `vite preview` on a given port, proxying /api to a given origin.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WIN = process.platform === 'win32';
const BATCH_SHIMS = new Set(['npm', 'npx']);
const isBatch = (cmd) => WIN && (BATCH_SHIMS.has(cmd) || /\.(cmd|bat)$/i.test(cmd));

// cmd.exe metacharacters. Escaping the quotes too keeps cmd out of "quoted" mode, so every caret counts.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
const quoteForCmd = (arg) => {
  // MSVCRT rules first (what the program finally parses): backslashes before a quote are doubled.
  let s = String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  s = `"${s}"`.replace(CMD_META, '^$1');
  // A batch shim re-parses its %* once more, so escape a second time.
  return s.replace(CMD_META, '^$1');
};

/** Command + options for child_process, routing batch shims through cmd.exe with escaped arguments. */
function spawnArgs(cmd, args) {
  if (!isBatch(cmd)) return { file: cmd, argv: args, extra: {} };
  const line = [cmd.replace(CMD_META, '^$1'), ...args.map(quoteForCmd)].join(' ');
  return { file: process.env.ComSpec || 'cmd.exe', argv: ['/d', '/s', '/c', `"${line}"`], extra: { windowsVerbatimArguments: true } };
}

/**
 * Runs a command synchronously and returns the spawnSync result.
 * Throws (command, exit status, stderr tail) unless `allowFail`.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ allowFail?: boolean, cwd?: string, env?: Record<string, string | undefined>, input?: string,
 *           stdio?: import('node:child_process').StdioOptions }} [opts]  env is merged over process.env;
 *           input is written to the child's stdin.
 */
export function run(cmd, args = [], { allowFail = false, cwd, env, input, stdio = 'pipe' } = {}) {
  const { file, argv, extra } = spawnArgs(cmd, args);
  const r = spawnSync(file, argv, {
    cwd,
    stdio,
    input,
    env: env ? { ...process.env, ...env } : undefined,
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    ...extra,
  });
  if ((r.status !== 0 || r.error) && !allowFail) {
    const detail = r.error?.message ?? String(r.stderr || r.stdout || '').slice(-2000);
    throw new Error(`${cmd} ${args.join(' ')} -> exit ${r.status}\n${detail}`);
  }
  return r;
}

/** `count` distinct 127.0.0.1 TCP ports that are free right now (all held open until every one is chosen). */
export async function freePorts(count) {
  const servers = [];
  try {
    for (let i = 0; i < count; i++) {
      const server = createServer();
      servers.push(server);
      await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
    }
    return servers.map((s) => s.address().port);
  } finally {
    await Promise.all(servers.map((s) => new Promise((ok) => s.close(() => ok()))));
  }
}

/** A 127.0.0.1 TCP port that is free right now. */
export const freePort = async () => (await freePorts(1))[0];

/**
 * Serves the existing web/dist build with `vite preview --host 127.0.0.1 --port <port> --strictPort`,
 * proxying /api to `apiOrigin` (CONGRESS_API_ORIGIN, read by web/vite.config.ts). Returns the child;
 * the caller waits for readiness and ends it with `stopProcess`.
 */
export function startPreview({ port, apiOrigin }) {
  const vite = resolve(root, 'web/node_modules/vite/bin/vite.js');
  return spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: resolve(root, 'web'),
    env: { ...process.env, CONGRESS_API_ORIGIN: apiOrigin },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

/** Ends a spawned process and its children (taskkill /T /F on Windows). */
export function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
}
