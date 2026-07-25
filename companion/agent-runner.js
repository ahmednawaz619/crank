'use strict';

/**
 * Optional headless Cursor agent runner (secondary UX).
 * Primary path is Retune-style MCP + skill pull. This only runs when the user
 * explicitly clicks "Run fully automatic" and CURSOR_API_KEY is set.
 *
 * Runtime:
 * - local (default): @cursor/sdk Agent.prompt with local.cwd = project root
 * - cloud: @cursor/sdk cloud agent against CURSOR_AGENT_REPO_URL (GitHub)
 * Falls back to Cursor CLI `agent -p` when the SDK package is unavailable.
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

/** @type {Map<string, object>} */
const jobs = new Map();

function apiKeyConfigured() {
  return Boolean(process.env.CURSOR_API_KEY && String(process.env.CURSOR_API_KEY).trim());
}

function resolveRuntime() {
  const raw = String(process.env.CURSOR_AGENT_RUNTIME || 'local')
    .trim()
    .toLowerCase();
  return raw === 'cloud' ? 'cloud' : 'local';
}

function resolveCloudRepoUrl() {
  const fromEnv = String(process.env.CURSOR_AGENT_REPO_URL || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const { execSync } = require('child_process');
    const url = execSync('git remote get-url origin', {
      cwd: process.env.CRANK_PROJECT_ROOT || process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (/^https?:\/\//i.test(url)) return url;
    // git@github.com:org/repo.git → https://github.com/org/repo
    const ssh = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/i);
    if (ssh) return `https://${ssh[1]}/${ssh[2].replace(/\.git$/i, '')}`;
  } catch {
    /* no remote */
  }
  return '';
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    taskId: job.taskId || null,
    variantLabel: job.variantLabel || null,
    mode: job.mode || null,
    runtime: job.runtime || null,
    error: job.error || null,
    logSnippet: job.logSnippet || ''
  };
}

function appendLog(job, chunk) {
  const text = String(chunk || '');
  if (!text) return;
  job.logSnippet = String(job.logSnippet || '')
    .concat(text)
    .slice(-4000);
}

function buildAutoPrompt(task, projectRoot) {
  const prompt = task?.prompt || '';
  return [
    'You are applying a pending Crank copy change automatically.',
    `Project root: ${projectRoot}`,
    '',
    'Use Crank MCP tools if available:',
    '- crank_get_pending_changes or get_pending_agent_prompt',
    '- apply_copy_variant with persist when appropriate',
    '- crank_clear_changes or ack_pending_agent_prompt when done',
    '',
    'Apply the mapped text changes to source files under the project root.',
    'Prefer hardcoded JSX/HTML literals. Do not invent i18n keys.',
    '',
    '--- PENDING TASK ---',
    prompt,
    '--- END ---'
  ].join('\n');
}

function classifySdkError(err) {
  const name = err && err.name ? String(err.name) : '';
  const message = err && err.message ? String(err.message) : String(err);
  const code = err && err.code ? String(err.code) : '';
  return {
    name: name || 'Error',
    message,
    code,
    isRetryable: Boolean(err && err.isRetryable)
  };
}

async function trySdkPrompt(prompt, projectRoot, job) {
  let Agent;
  let AuthenticationError;
  let ConfigurationError;
  let IntegrationNotConnectedError;
  try {
    ({
      Agent,
      AuthenticationError,
      ConfigurationError,
      IntegrationNotConnectedError
    } = require('@cursor/sdk'));
  } catch {
    return { used: false };
  }

  const runtime = resolveRuntime();
  job.runtime = runtime;
  job.mode = runtime === 'cloud' ? 'sdk-cloud' : 'sdk-local';

  const modelId = process.env.CURSOR_AGENT_MODEL || 'composer-2.5';
  /** @type {Record<string, unknown>} */
  const options = {
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: modelId }
  };

  if (runtime === 'cloud') {
    const repoUrl = resolveCloudRepoUrl();
    if (!repoUrl) {
      return {
        used: true,
        ok: false,
        error:
          'Cloud runtime needs CURSOR_AGENT_REPO_URL (or git remote origin). Connect GitHub in Cursor and set the HTTPS repo URL.'
      };
    }
    const startingRef =
      process.env.CURSOR_AGENT_STARTING_REF ||
      process.env.CURSOR_AGENT_BRANCH ||
      'main';
    options.cloud = {
      repos: [{ url: repoUrl, startingRef }],
      autoCreatePR: String(process.env.CURSOR_AGENT_AUTO_PR || '')
        .toLowerCase() === 'true',
      skipReviewerRequest: true
    };
    appendLog(
      job,
      `Starting @cursor/sdk cloud Agent.prompt against ${repoUrl} @ ${startingRef}…\n`
    );
  } else {
    options.local = { cwd: projectRoot };
    appendLog(job, 'Starting @cursor/sdk local Agent.prompt…\n');
  }

  try {
    const result = await Agent.prompt(prompt, options);
    appendLog(job, `SDK status: ${result?.status || 'unknown'}\n`);
    if (result?.result) appendLog(job, String(result.result).slice(0, 2000));
    if (result?.status === 'error') {
      return {
        used: true,
        ok: false,
        error: 'Cursor SDK agent finished with status error'
      };
    }
    return { used: true, ok: true, result };
  } catch (err) {
    const info = classifySdkError(err);
    let hint = info.message;
    if (AuthenticationError && err instanceof AuthenticationError) {
      hint = `AuthenticationError: ${info.message} (use a user or service-account key — Team Admin keys are not supported)`;
    } else if (ConfigurationError && err instanceof ConfigurationError) {
      hint = `ConfigurationError: ${info.message}`;
    } else if (
      IntegrationNotConnectedError &&
      err instanceof IntegrationNotConnectedError
    ) {
      hint = `IntegrationNotConnectedError: ${info.message} (connect GitHub in Cursor Dashboard → Integrations)`;
    } else if (info.name && info.name !== 'Error') {
      hint = `${info.name}: ${info.message}`;
    }
    appendLog(job, `\n${hint}\n`);
    return {
      used: true,
      ok: false,
      error: hint
    };
  }
}

function runCliAgent(prompt, projectRoot, job) {
  return new Promise((resolve) => {
    job.mode = 'cli';
    job.runtime = 'local';
    const agentBin = process.env.CURSOR_AGENT_BIN || 'agent';
    const args = [
      '-p',
      '--force',
      '--trust',
      '--workspace',
      projectRoot,
      prompt
    ];
    appendLog(job, `Starting CLI: ${agentBin} -p …\n`);
    const child = spawn(agentBin, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        CURSOR_API_KEY: process.env.CURSOR_API_KEY
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    job.pid = child.pid;
    child.stdout.on('data', (buf) => appendLog(job, buf.toString('utf8')));
    child.stderr.on('data', (buf) => appendLog(job, buf.toString('utf8')));
    child.on('error', (err) => {
      resolve({
        ok: false,
        error:
          err && err.code === 'ENOENT'
            ? 'Cursor CLI `agent` not found on PATH'
            : err.message || String(err)
      });
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({
          ok: false,
          error: `Cursor CLI agent exited with code ${code}`
        });
      }
    });
  });
}

/**
 * Start a background headless agent for a queued task.
 * @param {{ task: object, projectRoot: string, onUpdate?: Function }} opts
 */
function startAgentRun({ task, projectRoot, onUpdate }) {
  if (!apiKeyConfigured()) {
    const err = new Error(
      'Set CURSOR_API_KEY to enable one-click Agent apply'
    );
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  if (!task || !task.prompt) {
    throw new Error('No pending Crank task to run');
  }
  const root = path.resolve(projectRoot || process.cwd());
  if (!fs.existsSync(root)) {
    throw new Error(`Project root not found: ${root}`);
  }

  const job = {
    id: crypto.randomBytes(6).toString('hex'),
    status: 'queued',
    createdAt: new Date().toISOString(),
    taskId: task.id,
    variantLabel: task.variantLabel || task.variantId,
    logSnippet: '',
    projectRoot: root,
    runtime: resolveRuntime()
  };
  jobs.set(job.id, job);
  if (typeof onUpdate === 'function') onUpdate(publicJob(job));

  setImmediate(async () => {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    if (typeof onUpdate === 'function') onUpdate(publicJob(job));
    const prompt = buildAutoPrompt(task, root);
    try {
      const sdk = await trySdkPrompt(prompt, root, job);
      let result;
      if (sdk.used) {
        result = sdk;
      } else {
        result = await runCliAgent(prompt, root, job);
      }
      if (result.ok) {
        job.status = 'done';
      } else {
        job.status = 'failed';
        job.error = result.error || 'Agent run failed';
      }
    } catch (err) {
      job.status = 'failed';
      job.error = err && err.message ? err.message : String(err);
      appendLog(job, `\n${job.error}\n`);
    }
    job.finishedAt = new Date().toISOString();
    if (typeof onUpdate === 'function') onUpdate(publicJob(job));
  });

  return publicJob(job);
}

function getAgentRun(id) {
  return publicJob(jobs.get(id) || null);
}

function getLatestAgentRun() {
  let latest = null;
  for (const job of jobs.values()) {
    if (!latest || String(job.createdAt) > String(latest.createdAt)) {
      latest = job;
    }
  }
  return publicJob(latest);
}

module.exports = {
  apiKeyConfigured,
  resolveRuntime,
  resolveCloudRepoUrl,
  startAgentRun,
  getAgentRun,
  getLatestAgentRun
};
