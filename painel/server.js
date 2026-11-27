'use strict';

const major = Number(process.versions.node.split('.')[0]);
if (!major || major < 18) {
  console.error(
    'O painel do Liz precisa do Node.js 18 ou superior (versao atual: ' +
      process.version +
      '). Instale em nodejs.org ou com: winget install OpenJS.NodeJS.LTS'
  );
  process.exit(1);
}

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL } = require('url');

const IS_WIN = process.platform === 'win32';
const FW = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const LIZ_HOME = process.env.LIZ_HOME || path.join(os.homedir(), '.liz');
const LOCK_FILE = path.join(LIZ_HOME, 'painel.lock');

const DEFAULT_PORT =
  process.env.LIZ_PORT !== undefined && process.env.LIZ_PORT !== ''
    ? Number(process.env.LIZ_PORT)
    : 47615;
const IDLE_MS = Number(process.env.LIZ_IDLE_MS) || 20000;
const STARTUP_GRACE_MS = Number(process.env.LIZ_STARTUP_GRACE_MS) || 60000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_JOB_LOG_BYTES = 200 * 1024;
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const JOB_TIMEOUT_MS = 10 * 60 * 1000;
const GIT_TIMEOUT_MS = 5000;
const GH_TIMEOUT_MS = 20000;

const TOKEN = crypto.randomBytes(32).toString('hex');
const TOKEN_BUF = Buffer.from(TOKEN, 'utf8');

const STATIC_FILES = Object.freeze({
  '/app.js': { file: 'app.js', type: 'application/javascript; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
});

const CSP_HEADER =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const GUIDE_EXACT_FILES = new Set(['README.md', 'CHANGELOG.md']);
const GUIDE_ALLOWED_PREFIXES = [
  '.agents/skills/',
  '.agents/agents/',
  '.agents/knowledge/',
  '.agents/shared/',
];

const CYCLE_DEFINITION = [
  { step: 1, label: 'Warm-up', command: 'warm-up', group: 'Orientação', optional: false },
  { step: 2, label: 'Coletar ideia', command: 'product-collect', group: 'Produto', optional: false },
  { step: 3, label: 'Refinar', command: 'product-refine', group: 'Produto', optional: true },
  { step: 4, label: 'Especificar', command: 'product-spec', group: 'Produto', optional: true },
  { step: 5, label: 'Criar tarefa', command: 'product-feature', group: 'Produto', optional: false },
  { step: 6, label: 'Iniciar', command: 'engineer-start', group: 'Engenharia', optional: false },
  { step: 7, label: 'Spike', command: 'engineer-spike', group: 'Engenharia', optional: true },
  { step: 8, label: 'Planejar', command: 'engineer-plan', group: 'Engenharia', optional: false },
  { step: 9, label: 'Executar fase', command: 'engineer-work', group: 'Engenharia', optional: false },
  { step: 10, label: 'Pré-PR', command: 'engineer-pre-pr', group: 'Engenharia', optional: false },
  { step: 11, label: 'Abrir PR', command: 'engineer-pr', group: 'Engenharia', optional: false },
];

let actualPort = 0;
let server = null;
let startedAt = Date.now();
let gotFirstPing = false;
let lastPingAt = 0;
let shuttingDown = false;
let lockOwned = false;

const jobs = new Map();
let activeJobId = null;

function readFrameworkVersion() {
  try {
    return fs.readFileSync(path.join(FW, 'VERSION'), 'utf8').trim() || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function compareSemver(a, b) {
  const pa = String(a || '0.0.0').replace(/-.*$/, '').split('.').map((n) => Number(n) || 0);
  const pb = String(b || '0.0.0').replace(/-.*$/, '').split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

function safeTokenEqual(candidate) {
  if (typeof candidate !== 'string') return false;
  const buf = Buffer.from(candidate, 'utf8');
  if (buf.length !== TOKEN_BUF.length) return false;
  return crypto.timingSafeEqual(buf, TOKEN_BUF);
}

function normalizePathKey(p) {
  if (typeof p !== 'string' || !p.trim()) return '';
  let resolved = path.resolve(p).replace(/\\/g, '/');
  while (resolved.length > 1 && resolved.endsWith('/')) {
    if (/^[A-Za-z]:\/$/.test(resolved)) break;
    resolved = resolved.slice(0, -1);
  }
  return IS_WIN ? resolved.toLowerCase() : resolved;
}

function toDisplayPath(p) {
  return path.resolve(p).replace(/\\/g, '/');
}

function isSafePathInput(p) {
  if (typeof p !== 'string') return false;
  const trimmed = p.trim();
  if (!trimmed) return false;
  if (trimmed.includes('\0')) return false;
  if (trimmed.startsWith('-')) return false;
  return true;
}

function isInsideDir(parentDir, childPath) {
  const rel = path.relative(parentDir, childPath);
  if (rel === '') return true;
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return true;
}

function isInsideFramework(candidatePath) {
  let fwReal = FW;
  try {
    fwReal = fs.realpathSync(FW);
  } catch {
    fwReal = path.resolve(FW);
  }
  let targetReal = path.resolve(candidatePath);
  try {
    targetReal = fs.realpathSync(candidatePath);
  } catch {
    targetReal = path.resolve(candidatePath);
  }
  const fwKey = normalizePathKey(fwReal);
  const tKey = normalizePathKey(targetReal);
  return tKey === fwKey || tKey.startsWith(fwKey + '/');
}

function readRegisteredPaths() {
  const regFile = path.join(LIZ_HOME, 'projects.tsv');
  if (!fs.existsSync(regFile)) return [];
  const raw = fs.readFileSync(regFile, 'utf8');
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const col1 = line.split('\t')[0].trim();
    if (col1) out.push(col1);
  }
  return out;
}

function findRegisteredPath(candidate) {
  if (!isSafePathInput(candidate)) return null;
  const key = normalizePathKey(candidate);
  if (!key) return null;
  for (const entry of readRegisteredPaths()) {
    if (normalizePathKey(entry) === key) return entry;
  }
  return null;
}

function resolveBashPath() {
  if (process.env.LIZ_BASH && fs.existsSync(process.env.LIZ_BASH)) {
    return process.env.LIZ_BASH;
  }
  if (!IS_WIN) return 'bash';
  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    process.env['ProgramFiles(x86)'] &&
      path.join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function resolveGitPath() {
  if (!IS_WIN) return 'git';
  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'cmd', 'git.exe'),
    process.env['ProgramFiles(x86)'] &&
      path.join(process.env['ProgramFiles(x86)'], 'Git', 'cmd', 'git.exe'),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'git';
}

function spawnSimple(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs || 10000;
    const capture = opts.capture !== false;
    let child;
    try {
      child = spawn(cmd, args, {
        shell: false,
        windowsHide: true,
        cwd: opts.cwd || FW,
        env: opts.env || process.env,
        stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
      });
    } catch (err) {
      return resolve({ code: -1, stdout: '', stderr: '', error: err });
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }, timeoutMs);

    if (capture && child.stdout) {
      child.stdout.on('data', (c) => {
        if (stdout.length < MAX_JOB_LOG_BYTES) stdout += c.toString('utf8');
      });
    }
    if (capture && child.stderr) {
      child.stderr.on('data', (c) => {
        if (stderr.length < MAX_JOB_LOG_BYTES) stderr += c.toString('utf8');
      });
    }
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr, error: err, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

function runLizCommand(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const bashPath = resolveBashPath();
    if (!bashPath) {
      return reject(
        new Error(
          'Git Bash não encontrado. Instale o Git for Windows ou defina a variável LIZ_BASH.'
        )
      );
    }
    const lizScript = path.join(FW, 'liz.sh');
    spawnSimple(bashPath, [lizScript, ...args], { cwd: FW, timeoutMs }).then((r) => {
      if (r.error) return reject(r.error);
      if (r.timedOut) return reject(new Error('Tempo limite excedido ao executar o comando.'));
      resolve({ code: r.code, stdout: r.stdout, stderr: r.stderr });
    });
  });
}

function startJob(args) {
  if (activeJobId) {
    const active = jobs.get(activeJobId);
    if (active && active.status === 'running') {
      return { error: 'Já tem uma operação em andamento. Aguarde terminar.', status: 409 };
    }
  }
  const bashPath = resolveBashPath();
  if (!bashPath) {
    return {
      error: 'Git Bash não encontrado. Instale o Git for Windows ou defina a variável LIZ_BASH.',
      status: 500,
    };
  }

  const jobId = crypto.randomBytes(12).toString('hex');
  const job = {
    id: jobId,
    status: 'running',
    log: '',
    exitCode: null,
  };
  jobs.set(jobId, job);
  activeJobId = jobId;

  const lizScript = path.join(FW, 'liz.sh');
  const child = spawn(bashPath, [lizScript, ...args], {
    shell: false,
    windowsHide: true,
    cwd: FW,
    env: process.env,
  });

  const appendLog = (chunk) => {
    const text = chunk.toString('utf8').split(TOKEN).join('[oculto]');
    job.log += text;
    if (Buffer.byteLength(job.log, 'utf8') > MAX_JOB_LOG_BYTES) {
      const buf = Buffer.from(job.log, 'utf8');
      job.log = buf.subarray(buf.length - MAX_JOB_LOG_BYTES).toString('utf8');
    }
  };

  const timer = setTimeout(() => {
    appendLog('\n❌ Operação interrompida por exceder o limite de 10 minutos.\n');
    job.status = 'failed';
    job.exitCode = 124;
    if (activeJobId === jobId) activeJobId = null;
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }, JOB_TIMEOUT_MS);

  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);
  child.on('error', (err) => {
    clearTimeout(timer);
    appendLog('\n❌ Erro ao iniciar processo: ' + err.message + '\n');
    job.status = 'failed';
    job.exitCode = 1;
    if (activeJobId === jobId) activeJobId = null;
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (job.status === 'running') {
      job.exitCode = code ?? 1;
      job.status = code === 0 ? 'done' : 'failed';
    }
    if (activeJobId === jobId) activeJobId = null;
  });

  return { jobId };
}

function parseListTsv(raw) {
  const projects = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    if (cols.length < 11) continue;
    projects.push({
      path: cols[0],
      name: cols[1],
      installedVersion: cols[2],
      frameworkVersion: cols[3],
      status: cols[4],
      tools: cols[5],
      installedAt: cols[6],
      repos: Number(cols[7]) || 0,
      sessionsOpen: Number(cols[8]) || 0,
      docsBusiness: cols[9] === '1',
      docsTechnical: cols[10] === '1',
    });
  }
  return projects;
}

function parseInfoTsv(raw) {
  const result = { repos: [], sessions: [], docs: [] };
  let section = '';
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line === '#repos' || line === '#sessions' || line === '#docs') {
      section = line.slice(1);
      continue;
    }
    const cols = line.split('\t');
    if (section === 'repos' && cols.length >= 6) {
      result.repos.push({
        name: cols[0],
        path: cols[1],
        role: cols[2],
        stack: cols[3],
        branch: cols[4],
        changes: cols[5],
      });
    } else if (section === 'sessions' && cols.length >= 6) {
      result.sessions.push({
        slug: cols[0],
        phase: cols[1],
        phaseTitle: cols[2],
        status: cols[3],
        nextAction: cols[4],
        lastCheckpoint: cols[5],
        phasesTotal: cols[6] !== undefined && cols[6] !== '' ? Number(cols[6]) : null,
        phasesDone: cols[7] !== undefined && cols[7] !== '' ? Number(cols[7]) : null,
        blockedBy: cols[8] || '',
      });
    } else if (section === 'docs' && cols.length >= 3) {
      result.docs.push({
        group: cols[0],
        file: cols[1],
        title: cols[2],
      });
    }
  }
  return result;
}

// --- Fase 1: Guia do Liz (somente arquivos do framework) ---------------------

function parseFrontmatter(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return { name: '', description: '' };

  let name = '';
  let description = '';
  let inDescBlock = false;
  const descLines = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '---') break;

    if (inDescBlock) {
      if (/^[ \t]+/.test(line) || line.trim() === '') {
        if (line.trim() !== '') descLines.push(line.trim());
        continue;
      } else {
        inDescBlock = false;
      }
    }

    const mName = line.match(/^name:\s*(.+)$/);
    if (mName) {
      name = mName[1].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }

    const mDesc = line.match(/^description:\s*(.*)$/);
    if (mDesc) {
      const val = mDesc[1].trim();
      if (val === '|' || val === '>' || val === '|-' || val === '>-') {
        inDescBlock = true;
      } else {
        description = val.replace(/^['"]|['"]$/g, '');
      }
    }
  }

  if (descLines.length > 0 && !description) {
    description = descLines.join(' ');
  }

  return { name, description: shortenDescription(description, 220) };
}

function shortenDescription(text, maxLen) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= maxLen) return clean;
  // Tenta manter 1 ou 2 frases dentro do limite
  const sentences = clean.match(/[^.!?]+[.!?]+/g);
  if (sentences) {
    let acc = '';
    for (const s of sentences.slice(0, 2)) {
      const next = (acc ? acc + ' ' : '') + s.trim();
      if (next.length <= maxLen) acc = next;
      else break;
    }
    if (acc) return acc;
  }
  const cut = clean.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

function skillGroupOf(name) {
  if (name.startsWith('product-')) return 'Produto';
  if (name.startsWith('engineer-')) return 'Engenharia';
  if (name.startsWith('docs-')) return 'Documentação';
  return 'Orientação';
}

function buildGuideData() {
  const skillsDir = path.join(FW, '.agents', 'skills');
  const agentsDir = path.join(FW, '.agents', 'agents');
  const knowledgeDir = path.join(FW, '.agents', 'knowledge');

  const skills = [];
  const skillNames = new Set();
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      try {
        const md = fs.readFileSync(skillFile, 'utf8');
        const fm = parseFrontmatter(md);
        const name = fm.name || entry.name;
        skillNames.add(name);
        skills.push({
          name,
          group: skillGroupOf(name),
          description: fm.description || 'Comando do Liz Framework.',
          file: '.agents/skills/' + entry.name + '/SKILL.md',
        });
      } catch {
        // ignore
      }
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));

  const cycle = CYCLE_DEFINITION.filter((c) => skillNames.has(c.command));

  const agents = [];
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const agentFile = path.join(agentsDir, entry.name);
      try {
        const md = fs.readFileSync(agentFile, 'utf8');
        const fm = parseFrontmatter(md);
        const name = fm.name || entry.name.replace(/\.md$/i, '');
        agents.push({
          name,
          description: fm.description || 'Especialista do Liz Framework.',
          file: '.agents/agents/' + entry.name,
        });
      } catch {
        // ignore
      }
    }
  }
  agents.sort((a, b) => a.name.localeCompare(b.name));

  const knowledge = [];
  if (fs.existsSync(knowledgeDir)) {
    for (const entry of fs.readdirSync(knowledgeDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const kFile = path.join(knowledgeDir, entry.name);
      try {
        const md = fs.readFileSync(kFile, 'utf8');
        const m = md.match(/^#[ \t]+(.+)$/m);
        knowledge.push({
          file: '.agents/knowledge/' + entry.name,
          title: m ? m[1].trim() : entry.name,
        });
      } catch {
        // ignore
      }
    }
  }
  knowledge.sort((a, b) => a.title.localeCompare(b.title));

  return { cycle, skills, agents, knowledge };
}

function readAllowedGuideDoc(relFile) {
  if (!isSafePathInput(relFile)) {
    return { status: 400, error: 'Caminho de documento inválido.' };
  }
  const cleanRel = relFile.replace(/\\/g, '/').replace(/^\/+/, '');
  if (cleanRel.includes('..')) {
    return { status: 403, error: 'Caminho não permitido.' };
  }
  if (!cleanRel.toLowerCase().endsWith('.md')) {
    return { status: 403, error: 'Apenas arquivos Markdown (.md) podem ser abertos.' };
  }
  const prefixAllowed =
    GUIDE_EXACT_FILES.has(cleanRel) ||
    GUIDE_ALLOWED_PREFIXES.some((p) => cleanRel.startsWith(p));
  if (!prefixAllowed) {
    return { status: 403, error: 'Arquivo fora da lista permitida do Guia.' };
  }

  let fwReal;
  try {
    fwReal = fs.realpathSync(FW);
  } catch {
    return { status: 500, error: 'Pasta do framework inacessível.' };
  }

  const candidate = path.resolve(fwReal, cleanRel);
  let fileReal;
  try {
    fileReal = fs.realpathSync(candidate);
  } catch {
    return { status: 404, error: 'Documento do Guia não encontrado.' };
  }

  if (!fileReal.toLowerCase().endsWith('.md') || !isInsideDir(fwReal, fileReal)) {
    return { status: 403, error: 'Arquivo fora do framework.' };
  }

  const allowedReal =
    Array.from(GUIDE_EXACT_FILES).some((f) => {
      try {
        return normalizePathKey(fs.realpathSync(path.join(fwReal, f))) === normalizePathKey(fileReal);
      } catch {
        return false;
      }
    }) ||
    GUIDE_ALLOWED_PREFIXES.some((p) => {
      try {
        const dirReal = fs.realpathSync(path.join(fwReal, p));
        return isInsideDir(dirReal, fileReal);
      } catch {
        return false;
      }
    });

  if (!allowedReal) {
    return { status: 403, error: 'Arquivo fora das pastas permitidas do Guia.' };
  }

  let stat;
  try {
    stat = fs.statSync(fileReal);
  } catch {
    return { status: 404, error: 'Documento não encontrado.' };
  }
  if (!stat.isFile()) {
    return { status: 400, error: 'O caminho informado não é um arquivo.' };
  }
  if (stat.size > MAX_DOC_BYTES) {
    return { status: 413, error: 'Documento excede o limite de 2 MB.' };
  }

  const markdown = fs.readFileSync(fileReal, 'utf8');
  const firstHeading = markdown.match(/^#[ \t]+(.+)$/m);
  const title = firstHeading ? firstHeading[1].trim() : path.basename(fileReal);
  return { status: 200, data: { title, markdown } };
}

// --- Fase 2: Changelog -------------------------------------------------------

function parseChangelogFile() {
  const file = path.join(FW, 'CHANGELOG.md');
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const entries = [];
  let cur = null;

  for (const line of lines) {
    const m = line.match(/^##[ \t]+(\d+\.\d+\.\d+)[ \t]+[—–-][ \t]+(.+)$/);
    if (m) {
      if (cur) {
        cur.markdown = cur.lines.join('\n').trim();
        delete cur.lines;
        entries.push(cur);
      }
      cur = { version: m[1].trim(), date: m[2].trim(), lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) {
    cur.markdown = cur.lines.join('\n').trim();
    delete cur.lines;
    entries.push(cur);
  }

  entries.sort((a, b) => compareSemver(b.version, a.version));
  return entries;
}

function getChangelogEntries(fromVersion) {
  const current = readFrameworkVersion();
  const all = parseChangelogFile();
  if (!fromVersion) {
    return { current, entries: all };
  }
  const filtered = all.filter(
    (e) => compareSemver(e.version, fromVersion) > 0 && compareSemver(e.version, current) <= 0
  );
  return { current, entries: filtered };
}

// --- Fase 3: Check-up do projeto e PRs abertos -------------------------------

function readWorkspaceContextDirs(projectReal) {
  const wsFile = path.join(projectReal, '.agents', 'workspace.yaml');
  let bus = 'docs/business-context';
  let tech = 'docs/technical-context';
  if (fs.existsSync(wsFile)) {
    try {
      const content = fs.readFileSync(wsFile, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const mBus = line.match(/^context_business:\s*(.+)$/);
        if (mBus) {
          const v = mBus[1].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
          if (v) bus = v;
        }
        const mTech = line.match(/^context_technical:\s*(.+)$/);
        if (mTech) {
          const v = mTech[1].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
          if (v) tech = v;
        }
      }
    } catch {
      // ignore
    }
  }
  return [bus, tech];
}

function readProjectInstalledVersion(projectReal) {
  const verFile = path.join(projectReal, '.agents', '.liz-version');
  if (!fs.existsSync(verFile)) return '';
  try {
    const raw = fs.readFileSync(verFile, 'utf8');
    const m = raw.match(/^version:\s*(.+)$/m);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

function resolveRepoDir(projectReal, repoEntry) {
  const rp = repoEntry.path || repoEntry.name;
  if (!rp) return null;
  if (path.isAbsolute(rp)) return path.resolve(rp);
  return path.resolve(projectReal, rp);
}

async function checkupProject(projectReal, infoData) {
  const items = [];
  const gitBin = resolveGitPath();

  // 1. agents-md
  const agentsPath = path.join(projectReal, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    try {
      const txt = fs.readFileSync(agentsPath, 'utf8');
      if (txt.includes('<!-- PREENCHER')) {
        items.push({
          id: 'agents-md',
          level: 'aviso',
          title: 'AGENTS.md ainda tem campos para preencher',
          hint: '/warm-up',
        });
      }
    } catch {
      // ignore
    }
  } else {
    items.push({
      id: 'agents-md',
      level: 'aviso',
      title: 'AGENTS.md não encontrado na raiz do projeto',
      hint: '/warm-up',
    });
  }

  // 2, 3, 10: repos, env-tracked, main-dirty
  const repos = (infoData && infoData.repos) || [];
  for (const r of repos) {
    const repoDir = resolveRepoDir(projectReal, r);
    const hasGit =
      repoDir &&
      fs.existsSync(repoDir) &&
      (fs.existsSync(path.join(repoDir, '.git')) || fs.existsSync(path.join(repoDir, 'HEAD')));

    if (!hasGit) {
      items.push({
        id: 'repos',
        level: 'erro',
        title: `Repo não encontrado em ${r.path || r.name}; ajuste o workspace.yaml`,
        hint: '.agents/workspace.yaml',
      });
      continue;
    }

    // 3. env-tracked: só verifica código de saída, NUNCA lê nem retorna conteúdo de .env
    const envCheck = await spawnSimple(
      gitBin,
      ['ls-files', '--error-unmatch', '--', '.env'],
      { cwd: repoDir, timeoutMs: GIT_TIMEOUT_MS, capture: false }
    );
    if (envCheck.code === 0) {
      items.push({
        id: 'env-tracked',
        level: 'erro',
        title: `Arquivo .env está versionado no git em ${r.name}`,
        hint: 'Tire o .env do git e adicione ao .gitignore',
      });
    }

    // 10. main-dirty
    const changesNum = Number(r.changes) || 0;
    if ((r.branch === 'main' || r.branch === 'master') && changesNum > 0) {
      items.push({
        id: 'main-dirty',
        level: 'aviso',
        title: `Repo ${r.name} está na ${r.branch} com ${changesNum} alteração(ões)`,
        hint: 'Mude para uma branch feature/<slug>',
      });
    }
  }

  // 4. gitignore-env
  const giPath = path.join(projectReal, '.gitignore');
  let hasEnvIgnore = false;
  if (fs.existsSync(giPath)) {
    try {
      const gi = fs.readFileSync(giPath, 'utf8');
      hasEnvIgnore = /(^|\r?\n)\.env(\s|$|\.)/m.test(gi);
    } catch {
      // ignore
    }
  }
  if (!hasEnvIgnore) {
    items.push({
      id: 'gitignore-env',
      level: 'aviso',
      title: 'O .gitignore do workspace não inclui .env',
      hint: 'Adicione .env ao .gitignore da raiz',
    });
  }

  // 5, 6, 7: docs-tech, docs-biz, docs-stale
  const [ctxBus, ctxTech] = readWorkspaceContextDirs(projectReal);
  const techIndex = path.resolve(projectReal, ctxTech, 'index.md');
  const bizIndex = path.resolve(projectReal, ctxBus, 'index.md');

  if (!fs.existsSync(techIndex)) {
    items.push({
      id: 'docs-tech',
      level: 'aviso',
      title: 'Documentação técnica ainda não foi gerada',
      hint: '/docs-build-tech-docs',
    });
  } else {
    try {
      const st = fs.statSync(techIndex);
      const ageDays = Math.floor((Date.now() - st.mtimeMs) / (1000 * 60 * 60 * 24));
      if (ageDays > 90) {
        items.push({
          id: 'docs-stale',
          level: 'aviso',
          title: `Docs técnicos antigos (${ageDays} dias); regenere se a arquitetura mudou`,
          hint: '/docs-build-tech-docs',
        });
      }
    } catch {
      // ignore
    }
  }

  if (!fs.existsSync(bizIndex)) {
    items.push({
      id: 'docs-biz',
      level: 'aviso',
      title: 'Documentação de negócio ainda não foi gerada',
      hint: '/docs-build-business-docs',
    });
  }

  // 8. liz-version
  const instVer = readProjectInstalledVersion(projectReal);
  const fwVer = readFrameworkVersion();
  if (instVer && compareSemver(instVer, fwVer) < 0) {
    items.push({
      id: 'liz-version',
      level: 'aviso',
      title: `Versão do Liz desatualizada (v${instVer} → v${fwVer})`,
      hint: 'Atualizar',
    });
  }

  // 9. session-stale
  const sessions = (infoData && infoData.sessions) || [];
  for (const s of sessions) {
    if (!s.lastCheckpoint) continue;
    const ts = Date.parse(s.lastCheckpoint);
    if (!Number.isNaN(ts)) {
      const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
      if (days > 14) {
        items.push({
          id: 'session-stale',
          level: 'aviso',
          title: `Sessão ${s.slug} parada há ${days} dias`,
          hint: '/catch-up',
        });
      }
    }
  }

  return items;
}

async function listOpenPrs(projectReal, repoDir) {
  const r = await spawnSimple(
    'gh',
    ['pr', 'list', '--state', 'open', '--json', 'number,title,url,headRefName', '--limit', '20'],
    { cwd: repoDir, timeoutMs: GH_TIMEOUT_MS }
  );
  if (r.error) {
    return {
      unavailable: true,
      reason: 'GitHub CLI (gh) não encontrado nesta máquina.',
    };
  }
  if (r.timedOut) {
    return {
      unavailable: true,
      reason: 'Tempo limite excedido ao consultar o GitHub.',
    };
  }
  if (r.code !== 0) {
    return {
      unavailable: true,
      reason: 'Não foi possível consultar PRs (verifique login no gh ou remoto GitHub).',
    };
  }
  try {
    const parsed = JSON.parse(r.stdout || '[]');
    if (!Array.isArray(parsed)) return { prs: [] };
    return {
      prs: parsed.map((p) => ({
        number: Number(p.number) || 0,
        title: String(p.title || ''),
        url: String(p.url || ''),
        headRefName: String(p.headRefName || ''),
      })),
    };
  } catch {
    return { unavailable: true, reason: 'Resposta inesperada do gh.' };
  }
}

function readAllowedDoc(registeredProjectPath, relFile) {
  if (!isSafePathInput(relFile)) {
    return { status: 400, error: 'Caminho de documento inválido.' };
  }
  const cleanRel = relFile.replace(/\\/g, '/');
  if (!cleanRel.toLowerCase().endsWith('.md')) {
    return { status: 403, error: 'Apenas arquivos Markdown (.md) podem ser abertos.' };
  }
  const lowerRel = cleanRel.toLowerCase();
  if (lowerRel.includes('.env') || lowerRel.split('/').includes('.git')) {
    return { status: 403, error: 'Acesso negado a este arquivo.' };
  }

  let projectReal;
  try {
    projectReal = fs.realpathSync(registeredProjectPath);
  } catch {
    return { status: 404, error: 'Pasta do projeto não encontrada.' };
  }

  const candidate = path.resolve(projectReal, cleanRel);
  let fileReal;
  try {
    fileReal = fs.realpathSync(candidate);
  } catch {
    return { status: 404, error: 'Documento não encontrado.' };
  }

  if (!fileReal.toLowerCase().endsWith('.md')) {
    return { status: 403, error: 'Apenas arquivos Markdown (.md) podem ser abertos.' };
  }
  if (!isInsideDir(projectReal, fileReal)) {
    return { status: 403, error: 'Documento fora da pasta do projeto.' };
  }

  const [ctxBus, ctxTech] = readWorkspaceContextDirs(projectReal);
  const allowedDirs = [
    path.resolve(projectReal, 'docs'),
    path.resolve(projectReal, '.agents', 'sessions'),
    path.resolve(projectReal, ctxBus),
    path.resolve(projectReal, ctxTech),
  ]
    .map((d) => {
      try {
        return fs.realpathSync(d);
      } catch {
        return d;
      }
    })
    .filter((d) => isInsideDir(projectReal, d));

  const agentsMd = path.join(projectReal, 'AGENTS.md');
  let agentsReal = agentsMd;
  try {
    agentsReal = fs.realpathSync(agentsMd);
  } catch {
    // ignore
  }

  const allowed =
    normalizePathKey(fileReal) === normalizePathKey(agentsReal) ||
    allowedDirs.some((dir) => isInsideDir(dir, fileReal));

  if (!allowed) {
    return { status: 403, error: 'Arquivo fora das pastas de documentação permitidas.' };
  }

  let stat;
  try {
    stat = fs.statSync(fileReal);
  } catch {
    return { status: 404, error: 'Documento não encontrado.' };
  }
  if (!stat.isFile()) {
    return { status: 400, error: 'O caminho informado não é um arquivo.' };
  }
  if (stat.size > MAX_DOC_BYTES) {
    return { status: 413, error: 'Documento excede o limite de 2 MB.' };
  }

  const markdown = fs.readFileSync(fileReal, 'utf8');
  const firstHeading = markdown.match(/^#[ \t]+(.+)$/m);
  const title = firstHeading ? firstHeading[1].trim() : path.basename(fileReal);
  return { status: 200, data: { title, markdown } };
}

function pickFolderDialog() {
  return new Promise((resolve) => {
    if (!IS_WIN) {
      return resolve({
        status: 501,
        error: 'Seletor gráfico disponível apenas no Windows. Informe o caminho manualmente.',
      });
    }
    const psScript = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      'Add-Type -AssemblyName System.Windows.Forms',
      '$owner = New-Object System.Windows.Forms.Form',
      '$owner.TopMost = $true',
      '$owner.ShowInTaskbar = $false',
      '$owner.WindowState = [System.Windows.Forms.FormWindowState]::Minimized',
      '$owner.Load.Add({ $owner.Visible = $false })',
      '$dlg = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$dlg.Description = "Selecione a pasta do projeto"',
      '$dlg.ShowNewFolderButton = $true',
      '$res = $dlg.ShowDialog($owner)',
      '$owner.Dispose()',
      'if ($res -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dlg.SelectedPath }',
    ].join('; ');

    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', psScript], {
      shell: false,
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (c) => {
      out += c.toString('utf8');
    });
    child.on('error', () => {
      resolve({
        status: 500,
        error: 'Não foi possível abrir o seletor de pastas. Informe o caminho manualmente.',
      });
    });
    child.on('close', () => {
      const folder = out.trim();
      if (!folder) return resolve({ status: 200, data: { cancelled: true } });
      resolve({ status: 200, data: { folder: folder.replace(/\\/g, '/') } });
    });
  });
}

function openFolderInOs(folderPath) {
  const abs = path.resolve(folderPath);
  if (IS_WIN) {
    const child = spawn('explorer.exe', [abs.replace(/\//g, '\\')], {
      shell: false,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {});
    child.unref();
  } else if (process.platform === 'darwin') {
    const child = spawn('open', [abs], { shell: false, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } else {
    const child = spawn('xdg-open', [abs], { shell: false, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  }
}

function baseHeaders(extra = {}) {
  return Object.assign(
    {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    },
    extra
  );
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(
    status,
    baseHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body, 'utf8'),
    })
  );
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        aborted = true;
        reject({ status: 413, error: 'Corpo da requisição excede o limite de 16 KB.' });
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject({ status: 400, error: 'O corpo JSON deve ser um objeto.' });
        }
        resolve(parsed);
      } catch {
        reject({ status: 400, error: 'JSON inválido na requisição.' });
      }
    });
    req.on('error', () => {
      if (!aborted) reject({ status: 400, error: 'Erro ao ler o corpo da requisição.' });
    });
  });
}

function validateNewFolder(folder) {
  if (!isSafePathInput(folder)) {
    return { error: 'Informe um caminho de pasta válido.' };
  }
  const abs = path.resolve(folder);
  if (!fs.existsSync(abs)) {
    return { error: 'Pasta não encontrada. Confira o caminho.' };
  }
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return { error: 'Não foi possível acessar a pasta informada.' };
  }
  if (!stat.isDirectory()) {
    return { error: 'O caminho informado não é uma pasta.' };
  }
  if (isInsideFramework(abs)) {
    return { error: 'Esta pasta é o próprio liz-framework. Escolha a pasta de um projeto.' };
  }
  return { abs };
}

async function handleApi(req, res, urlObj) {
  const tokenHeader = req.headers['x-liz-token'];
  if (!safeTokenEqual(tokenHeader)) {
    return sendJson(res, 401, { error: 'Token ausente ou inválido.' });
  }

  if (req.method === 'POST') {
    const expectedOrigin = `http://127.0.0.1:${actualPort}`;
    if (req.headers.origin !== expectedOrigin) {
      return sendJson(res, 403, { error: 'Origem não autorizada.' });
    }
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (!ct.startsWith('application/json')) {
      return sendJson(res, 400, { error: 'Content-Type deve ser application/json.' });
    }
  }

  const pathname = urlObj.pathname;

  if (req.method === 'POST' && pathname === '/api/ping') {
    try {
      await readJsonBody(req);
    } catch (e) {
      return sendJson(res, e.status || 400, { error: e.error || 'Requisição inválida.' });
    }
    gotFirstPing = true;
    lastPingAt = Date.now();
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/guide') {
    return sendJson(res, 200, buildGuideData());
  }

  if (req.method === 'GET' && pathname === '/api/guide/doc') {
    const relFile = urlObj.searchParams.get('file') || '';
    const result = readAllowedGuideDoc(relFile);
    if (result.status !== 200) {
      return sendJson(res, result.status, { error: result.error });
    }
    return sendJson(res, 200, result.data);
  }

  if (req.method === 'GET' && pathname === '/api/changelog') {
    const from = (urlObj.searchParams.get('from') || '').trim();
    if (from && !/^\d+\.\d+\.\d+$/.test(from)) {
      return sendJson(res, 400, { error: 'Versão inválida no parâmetro from (esperado: X.Y.Z).' });
    }
    return sendJson(res, 200, getChangelogEntries(from || null));
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    try {
      const r = await runLizCommand(['list', '--tsv']);
      if (r.code !== 0) {
        return sendJson(res, 500, {
          error: (r.stderr || r.stdout || 'Erro ao listar projetos.').trim(),
        });
      }
      return sendJson(res, 200, {
        framework: { version: readFrameworkVersion(), path: toDisplayPath(FW) },
        projects: parseListTsv(r.stdout),
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method === 'GET' && pathname === '/api/project') {
    const reqPath = urlObj.searchParams.get('path') || '';
    const regPath = findRegisteredPath(reqPath);
    if (!regPath) {
      return sendJson(res, 403, { error: 'Projeto não está no registro.' });
    }
    let projectReal;
    try {
      projectReal = fs.realpathSync(regPath);
    } catch {
      return sendJson(res, 404, { error: 'Pasta do projeto não encontrada.' });
    }
    try {
      const r = await runLizCommand(['info', regPath, '--tsv']);
      if (r.code !== 0) {
        return sendJson(res, 404, {
          error: (r.stderr || r.stdout || 'Não foi possível ler os detalhes do projeto.').trim(),
        });
      }
      const infoData = parseInfoTsv(r.stdout);
      const checkup = await checkupProject(projectReal, infoData);
      return sendJson(res, 200, Object.assign(infoData, { checkup }));
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method === 'GET' && pathname === '/api/doc') {
    const reqPath = urlObj.searchParams.get('path') || '';
    const relFile = urlObj.searchParams.get('file') || '';
    const regPath = findRegisteredPath(reqPath);
    if (!regPath) {
      return sendJson(res, 403, { error: 'Projeto não está no registro.' });
    }
    const result = readAllowedDoc(regPath, relFile);
    if (result.status !== 200) {
      return sendJson(res, result.status, { error: result.error });
    }
    return sendJson(res, 200, result.data);
  }

  if (req.method === 'GET' && pathname.startsWith('/api/jobs/')) {
    const id = pathname.slice('/api/jobs/'.length);
    const job = jobs.get(id);
    if (!job) {
      return sendJson(res, 404, { error: 'Operação não encontrada.' });
    }
    return sendJson(res, 200, {
      status: job.status,
      log: job.log,
      exitCode: job.exitCode,
    });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      return sendJson(res, e.status || 400, { error: e.error || 'Requisição inválida.' });
    }

    if (pathname === '/api/prs') {
      const regPath = findRegisteredPath(body.path);
      if (!regPath) {
        return sendJson(res, 403, { error: 'Projeto não está no registro.' });
      }
      if (typeof body.repo !== 'string' || !body.repo.trim() || body.repo.includes('\0')) {
        return sendJson(res, 400, { error: 'Nome de repo inválido.' });
      }
      let projectReal;
      try {
        projectReal = fs.realpathSync(regPath);
      } catch {
        return sendJson(res, 404, { error: 'Pasta do projeto não encontrada.' });
      }
      try {
        const r = await runLizCommand(['info', regPath, '--tsv']);
        if (r.code !== 0) {
          return sendJson(res, 404, { error: 'Não foi possível ler os repos do projeto.' });
        }
        const infoData = parseInfoTsv(r.stdout);
        const match = infoData.repos.find((x) => x.name === body.repo.trim());
        if (!match) {
          return sendJson(res, 403, { error: 'Repo não encontrado no workspace.yaml deste projeto.' });
        }
        const repoDir = resolveRepoDir(projectReal, match);
        if (!repoDir || !fs.existsSync(repoDir)) {
          return sendJson(res, 404, { error: 'Pasta do repo não encontrada.' });
        }
        const prsResult = await listOpenPrs(projectReal, repoDir);
        return sendJson(res, 200, prsResult);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (pathname === '/api/update') {
      const args = ['update'];
      if (body.all === true) {
        args.push('--all');
      } else {
        const regPath = findRegisteredPath(body.path);
        if (!regPath) {
          return sendJson(res, 403, { error: 'Projeto não está no registro.' });
        }
        args.push(regPath);
      }
      if (body.pull === true) args.push('--pull');
      const started = startJob(args);
      if (started.error) return sendJson(res, started.status, { error: started.error });
      return sendJson(res, 200, { jobId: started.jobId });
    }

    if (pathname === '/api/install') {
      const check = validateNewFolder(body.folder);
      if (check.error) return sendJson(res, 400, { error: check.error });
      const args = ['install', check.abs];
      if (body.tools !== undefined && body.tools !== '') {
        if (typeof body.tools !== 'string' || !/^[a-z0-9,_-]+$/i.test(body.tools)) {
          return sendJson(res, 400, { error: 'Lista de ferramentas inválida.' });
        }
        args.push('--tools', body.tools);
      }
      const started = startJob(args);
      if (started.error) return sendJson(res, started.status, { error: started.error });
      return sendJson(res, 200, { jobId: started.jobId });
    }

    if (pathname === '/api/scan') {
      const check = validateNewFolder(body.folder);
      if (check.error) return sendJson(res, 400, { error: check.error });
      const started = startJob(['scan', check.abs]);
      if (started.error) return sendJson(res, started.status, { error: started.error });
      return sendJson(res, 200, { jobId: started.jobId });
    }

    if (pathname === '/api/add') {
      const check = validateNewFolder(body.path);
      if (check.error) return sendJson(res, 400, { error: check.error });
      if (!fs.existsSync(path.join(check.abs, '.agents', '.liz-version'))) {
        return sendJson(res, 400, {
          error: 'Esta pasta não tem o Liz instalado. Use "Instalar o Liz aqui".',
        });
      }
      try {
        const r = await runLizCommand(['add', check.abs]);
        if (r.code !== 0) {
          return sendJson(res, 400, {
            error: (r.stderr || r.stdout || 'Não foi possível adicionar o projeto.').trim(),
          });
        }
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (pathname === '/api/remove') {
      const regPath = findRegisteredPath(body.path);
      if (!regPath) {
        return sendJson(res, 403, { error: 'Projeto não está no registro.' });
      }
      try {
        const r = await runLizCommand(['remove', regPath]);
        if (r.code !== 0) {
          return sendJson(res, 400, {
            error: (r.stderr || r.stdout || 'Não foi possível remover o projeto.').trim(),
          });
        }
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (pathname === '/api/check') {
      const started = startJob(['check']);
      if (started.error) return sendJson(res, started.status, { error: started.error });
      return sendJson(res, 200, { jobId: started.jobId });
    }

    if (pathname === '/api/open-folder') {
      const regPath = findRegisteredPath(body.path);
      if (!regPath) {
        return sendJson(res, 403, { error: 'Projeto não está no registro.' });
      }
      if (!fs.existsSync(regPath)) {
        return sendJson(res, 404, { error: 'A pasta do projeto não existe mais.' });
      }
      openFolderInOs(regPath);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/pick-folder') {
      const picked = await pickFolderDialog();
      if (picked.status !== 200) {
        return sendJson(res, picked.status, { error: picked.error });
      }
      return sendJson(res, 200, picked.data);
    }
  }

  return sendJson(res, 404, { error: 'Rota não encontrada.' });
}

function handleRequest(req, res) {
  const expectedHost = `127.0.0.1:${actualPort}`;
  if (req.headers.host !== expectedHost) {
    return sendJson(res, 403, { error: 'Cabeçalho Host inválido.' });
  }

  if (req.method === 'OPTIONS') {
    return sendJson(res, 405, { error: 'Método OPTIONS não permitido.' });
  }

  let urlObj;
  try {
    urlObj = new URL(req.url || '/', `http://${expectedHost}`);
  } catch {
    return sendJson(res, 400, { error: 'URL inválida.' });
  }

  if (urlObj.pathname.startsWith('/api/')) {
    handleApi(req, res, urlObj).catch((err) => {
      sendJson(res, 500, { error: err && err.message ? err.message : 'Erro interno.' });
    });
    return;
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Método não permitido.' });
  }

  if (urlObj.pathname === '/' || urlObj.pathname === '/index.html') {
    const t = urlObj.searchParams.get('t') || '';
    if (!safeTokenEqual(t)) {
      return sendJson(res, 401, {
        error: 'Acesso não autorizado. Abra o painel pelo atalho ou comando liz.sh painel.',
      });
    }
    try {
      const html = fs
        .readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
        .replace('__LIZ_TOKEN__', TOKEN);
      res.writeHead(
        200,
        baseHeaders({
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': CSP_HEADER,
          'Content-Length': Buffer.byteLength(html, 'utf8'),
        })
      );
      res.end(html);
    } catch {
      sendJson(res, 500, { error: 'Arquivo index.html não encontrado.' });
    }
    return;
  }

  const staticEntry = STATIC_FILES[urlObj.pathname];
  if (staticEntry) {
    try {
      const content = fs.readFileSync(path.join(PUBLIC_DIR, staticEntry.file));
      res.writeHead(
        200,
        baseHeaders({
          'Content-Type': staticEntry.type,
          'Content-Length': content.length,
        })
      );
      res.end(content);
    } catch {
      sendJson(res, 404, { error: 'Arquivo estático não encontrado.' });
    }
    return;
  }

  return sendJson(res, 404, { error: 'Recurso não encontrado.' });
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function acquireLock() {
  fs.mkdirSync(LIZ_HOME, { recursive: true });
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (data && isPidAlive(data.pid) && data.pid !== process.pid) {
        console.log('O painel já está aberto (PID ' + data.pid + ').');
        process.exit(0);
      }
    } catch {
      // lock obsoleto ou corrompido
    }
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {
      // ignore
    }
  }
}

function writeLock(port) {
  try {
    fs.writeFileSync(
      LOCK_FILE,
      JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }),
      'utf8'
    );
    lockOwned = true;
  } catch {
    // ignore
  }
}

function releaseLock() {
  if (!lockOwned) return;
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const data = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (data && data.pid === process.pid) {
        fs.unlinkSync(LOCK_FILE);
      }
    }
  } catch {
    // ignore
  }
  lockOwned = false;
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  releaseLock();
  if (server) {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  } else {
    process.exit(0);
  }
}

function openBrowserWindow(url) {
  if (process.env.LIZ_NO_OPEN === '1') {
    console.log('URL: ' + url);
    return;
  }

  if (IS_WIN) {
    const edgePaths = [
      process.env['ProgramFiles(x86)'] &&
        path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      process.env.ProgramFiles &&
        path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ].filter(Boolean);
    const edgeExe = edgePaths.find((p) => fs.existsSync(p));
    if (edgeExe) {
      const profileDir = path.join(LIZ_HOME, 'edge-profile');
      const child = spawn(
        edgeExe,
        [
          `--app=${url}`,
          `--user-data-dir=${profileDir}`,
          '--no-first-run',
          '--window-size=1100,760',
        ],
        { shell: false, detached: true, stdio: 'ignore' }
      );
      child.on('error', () => {});
      child.unref();
      return;
    }
    const fallback = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      shell: false,
      detached: true,
      stdio: 'ignore',
    });
    fallback.on('error', () => {});
    fallback.unref();
    return;
  }

  if (process.platform === 'darwin') {
    const edgeApp = '/Applications/Microsoft Edge.app';
    const args = fs.existsSync(edgeApp)
      ? ['-a', 'Microsoft Edge', '--args', `--app=${url}`]
      : [url];
    const child = spawn('open', args, { shell: false, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return;
  }

  const child = spawn('xdg-open', [url], { shell: false, detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function startServer() {
  acquireLock();
  server = http.createServer(handleRequest);

  const onListening = () => {
    actualPort = server.address().port;
    startedAt = Date.now();
    writeLock(actualPort);

    const url = `http://127.0.0.1:${actualPort}/?t=${TOKEN}`;
    openBrowserWindow(url);

    setInterval(() => {
      const now = Date.now();
      if (gotFirstPing) {
        if (now - lastPingAt > IDLE_MS) shutdown();
      } else if (now - startedAt > STARTUP_GRACE_MS) {
        shutdown();
      }
    }, 1000).unref();
  };

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && actualPort === 0) {
      server.listen(0, '127.0.0.1');
    } else {
      console.error('Erro ao iniciar o servidor do painel:', err.message);
      releaseLock();
      process.exit(1);
    }
  });

  server.once('listening', onListening);
  server.listen(DEFAULT_PORT, '127.0.0.1');
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', releaseLock);

if (require.main === module) {
  startServer();
}

module.exports = {
  compareSemver,
  parseFrontmatter,
  parseChangelogFile,
  checkupProject,
};
