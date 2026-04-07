// Installation verification script for Pi-Tainá
// Run: npm run test:install
// Checks if the installation is healthy WITHOUT needing API keys or network.

import { spawnSync } from 'child_process';
import { existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';

// ─── Result tracking ──────────────────────────────────────────────────────────

let passed = 0;
let warnings = 0;
let failed = 0;
let hasFatal = false;

function pass(msg: string): void {
  console.log(`✅ ${msg}`);
  passed++;
}

function warn(msg: string): void {
  console.log(`⚠️  ${msg}`);
  warnings++;
}

function fail(msg: string): void {
  console.log(`❌ ${msg}`);
  failed++;
  hasFatal = true;
}

// ─── Check 1: Node.js version ─────────────────────────────────────────────────

function checkNodeVersion(): void {
  const version = process.version; // e.g. "v20.11.0"
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major >= 20) {
    pass(`Node.js ${version}`);
  } else {
    fail(`Node.js ${version} — requires >= v20`);
  }
}

// ─── Check 2: Critical dependencies ──────────────────────────────────────────

async function checkDependency(name: string, importPath: string): Promise<void> {
  try {
    await import(importPath);
    pass(`${name} loaded`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`${name} failed to load — ${msg}`);
  }
}

async function checkNativeModules(): Promise<void> {
  try {
    await import('koffi');
    pass('koffi (native) loaded');
  } catch {
    warn('koffi not available — AudioMoth chime generation will be disabled');
  }
}

// ─── Check 3: Python 3 ────────────────────────────────────────────────────────

function checkPython3(): void {
  const result = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  if (result.error) {
    fail(`python3 not found — ${result.error.message}`);
    return;
  }
  if (result.status !== 0) {
    fail(`python3 exited with code ${result.status}`);
    return;
  }
  const version = (result.stdout || result.stderr || '').trim();
  pass(version || 'Python 3 available');
}

// ─── Check 4 & 5: .env file and required vars ────────────────────────────────

async function checkEnvFileAndVars(): Promise<void> {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    warn('.env file not found — copy .env.example to .env and fill in your values');
    return;
  }

  pass('.env file exists');

  // Load .env vars via dotenv so we can check them
  try {
    const dotenv = await import('dotenv');
    dotenv.config();
  } catch {
    // dotenv already verified as loadable above; ignore errors here
  }

  const required = ['TELEGRAM_BOT_TOKEN', 'GEMINI_API_KEY', 'ADMIN_USER_ID'];
  for (const key of required) {
    const val = process.env[key];
    if (!val || val.trim() === '') {
      warn(`.env exists but ${key} is empty`);
    }
  }
}

// ─── Check 6: data/ directory ────────────────────────────────────────────────

function checkDataDir(): void {
  const dataPath = join(process.cwd(), 'data');
  if (existsSync(dataPath)) {
    pass('data/ directory OK');
  } else {
    try {
      mkdirSync(dataPath, { recursive: true });
      pass('data/ directory created');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(`data/ directory could not be created — ${msg}`);
    }
  }
}

// ─── Check 7: skills/ directory ──────────────────────────────────────────────

function checkSkillsDir(): void {
  const skillsPath = join(process.cwd(), 'skills');
  if (!existsSync(skillsPath)) {
    fail('skills/ directory not found');
    return;
  }

  let subdirs: string[];
  try {
    subdirs = readdirSync(skillsPath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`skills/ directory not readable — ${msg}`);
    return;
  }

  pass(`skills/ directory OK (${subdirs.length} skills)`);
}

// ─── Check 8: generate-chime.py ──────────────────────────────────────────────

function checkGenerateChimePy(): void {
  const chimePath = join(process.cwd(), 'skills', 'audiomoth-chime', 'generate-chime.py');
  if (!existsSync(chimePath)) {
    warn('generate-chime.py not found at skills/audiomoth-chime/generate-chime.py');
    return;
  }

  const result = spawnSync(
    'python3',
    ['-c', `import ast; ast.parse(open("${chimePath}").read())`],
    { encoding: 'utf8' }
  );

  if (result.error) {
    warn(`generate-chime.py syntax check failed — ${result.error.message}`);
    return;
  }

  if (result.status !== 0) {
    const errMsg = (result.stderr || '').trim();
    warn(`generate-chime.py has syntax errors — ${errMsg}`);
    return;
  }

  pass('generate-chime.py valid');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🌿 Pi-Tainá Installation Check');
  console.log('==================================');

  // 1. Node.js version
  checkNodeVersion();

  // 2. Critical dependencies
  await checkDependency('grammy', 'grammy');
  await checkDependency('pi-coding-agent', '@mariozechner/pi-coding-agent');
  await checkDependency('@google/generative-ai', '@google/generative-ai');
  await checkDependency('dotenv', 'dotenv');

  // 3. Native modules (non-fatal)
  await checkNativeModules();

  // 4. Python 3
  checkPython3();

  // 5 & 6. .env file and required vars
  await checkEnvFileAndVars();

  // 7. data/ directory
  checkDataDir();

  // 8. skills/ directory
  checkSkillsDir();

  // 9. generate-chime.py
  checkGenerateChimePy();

  // ─── Summary ────────────────────────────────────────────────────────────────
  console.log('');
  console.log(`Result: ${passed} passed, ${warnings} warning${warnings !== 1 ? 's' : ''}, ${failed} failed`);

  process.exit(hasFatal ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
