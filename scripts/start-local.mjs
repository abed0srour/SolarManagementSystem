#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import net from 'net';
import fs from 'fs';
import process from 'process';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

console.log(`${colors.bright}${colors.cyan}======================================================${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}  ☀️  Solar Store Management System - Local Launcher  ${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}======================================================${colors.reset}\n`);

const isWindows = process.platform === 'win32';
let backendProcess = null;
let frontendProcess = null;

// Free ports 3000 & 5173 if previously occupied
function freePort(port) {
  try {
    if (isWindows) {
      const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const lines = output.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && pid !== String(process.pid)) {
          try {
            execSync(`taskkill /PID ${pid} /F 2>nul`, { shell: 'cmd.exe' });
            console.log(`${colors.yellow}🧹 Freed port ${port} (terminated orphaned process ${pid})${colors.reset}`);
          } catch {}
        }
      }
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`);
    }
  } catch {}
}

freePort(3000);
freePort(5173);

function pipeOutput(proc, prefix, color) {
  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.log(`${color}[${prefix}]${colors.reset} ${line}`);
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.error(`${color}[${prefix} ERR]${colors.reset} ${line}`);
      }
    }
  });
}

function waitForPort(port, host = '127.0.0.1', timeoutMs = 45000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const socket = new net.Socket();
      socket.setTimeout(1000);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        retry();
      });

      socket.on('error', () => {
        socket.destroy();
        retry();
      });

      socket.connect(port, host);
    };

    const retry = () => {
      if (Date.now() - startTime >= timeoutMs) {
        reject(new Error(`Timeout waiting for port ${port} on ${host}`));
      } else {
        setTimeout(check, 500);
      }
    };

    check();
  });
}

function cleanup() {
  console.log(`\n${colors.yellow}🛑 Shutting down backend and frontend processes...${colors.reset}`);

  if (isWindows) {
    if (backendProcess && backendProcess.pid) {
      try { execSync(`taskkill /PID ${backendProcess.pid} /T /F 2>nul`); } catch {}
    }
    if (frontendProcess && frontendProcess.pid) {
      try { execSync(`taskkill /PID ${frontendProcess.pid} /T /F 2>nul`); } catch {}
    }
  } else {
    if (backendProcess) backendProcess.kill('SIGINT');
    if (frontendProcess) frontendProcess.kill('SIGINT');
  }

  freePort(3000);
  freePort(5173);

  console.log(`${colors.green}👋 Local environment stopped.${colors.reset}`);
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

async function main() {
  // Step 1: Docker Database
  console.log(`${colors.yellow}📦 [1/3] Starting PostgreSQL database via Docker...${colors.reset}`);
  try {
    execSync('docker compose up -d db', { stdio: 'inherit' });
    console.log(`${colors.green}✅ PostgreSQL is running on localhost:5432.${colors.reset}\n`);
  } catch (err) {
    console.error(`${colors.red}❌ Failed to start Docker database. Please ensure Docker Desktop is running.${colors.reset}`);
    process.exit(1);
  }

  // Step 2: Backend API
  console.log(`${colors.yellow}⚙️  [2/3] Starting Backend API and waiting for server on http://localhost:3000...${colors.reset}`);
  backendProcess = isWindows
    ? spawn('cmd.exe', ['/c', 'npm', 'run', 'start:dev'], { cwd: './backend', stdio: 'pipe' })
    : spawn('npm', ['run', 'start:dev'], { cwd: './backend', stdio: 'pipe' });

  pipeOutput(backendProcess, 'Backend', colors.cyan);

  try {
    await waitForPort(3000, '127.0.0.1', 45000);
    console.log(`\n${colors.green}✅ Backend API is live and ready on http://localhost:3000!${colors.reset}\n`);
  } catch (err) {
    console.error(`${colors.red}❌ Backend did not become ready in time.${colors.reset}`);
    cleanup();
  }

  // Step 3: Frontend Web App
  console.log(`${colors.yellow}💻 [3/3] Starting Frontend App with instant Hot-Reload on http://localhost:5173...${colors.reset}\n`);
  
  // Clean stale build cache if present to prevent module mismatches
  try {
    if (fs.existsSync('./frontend/.next')) {
      fs.rmSync('./frontend/.next', { recursive: true, force: true });
    }
  } catch {}

  frontendProcess = isWindows
    ? spawn('cmd.exe', ['/c', 'npm', 'run', 'dev'], { cwd: './frontend', stdio: 'pipe' })
    : spawn('npm', ['run', 'dev'], { cwd: './frontend', stdio: 'pipe' });

  pipeOutput(frontendProcess, 'Frontend', colors.magenta);

  try {
    await waitForPort(5173, '127.0.0.1', 45000);
    
    // Final Live Dashboard Banner
    console.log(`\n${colors.bright}${colors.green}========================================================================${colors.reset}`);
    console.log(`${colors.bright}${colors.green}  🚀 YOU ARE LIVE NOW!                                                 ${colors.reset}`);
    console.log(`${colors.bright}${colors.green}========================================================================${colors.reset}`);
    console.log(`  🌐 ${colors.bright}Frontend App:${colors.reset}       ${colors.cyan}http://localhost:5173${colors.reset}`);
    console.log(`  ⚙️  ${colors.bright}Backend API:${colors.reset}        ${colors.cyan}http://localhost:3000${colors.reset}`);
    console.log(`  📚 ${colors.bright}Swagger API Docs:${colors.reset}   ${colors.cyan}http://localhost:3000/api/docs${colors.reset}`);
    console.log(`  🗄️  ${colors.bright}Database:${colors.reset}           ${colors.cyan}localhost:5432 (PostgreSQL)${colors.reset}`);
    console.log(`------------------------------------------------------------------------`);
    console.log(`  🔑 ${colors.bright}Default Login Credentials:${colors.reset}`);
    console.log(`     • ${colors.bright}Store Admin:${colors.reset}   admin@solarstore.local / TenantAdmin!2026`);
    console.log(`     • ${colors.bright}Super Admin:${colors.reset}   superadmin@solarstore.local / SuperAdmin!2026`);
    console.log(`${colors.bright}${colors.green}========================================================================${colors.reset}\n`);
  } catch (err) {
    console.error(`${colors.red}❌ Frontend did not become ready in time.${colors.reset}`);
    cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  cleanup();
});
