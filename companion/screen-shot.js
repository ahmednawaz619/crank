'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sourcePath = path.join(__dirname, 'capture-shot.swift');
const binaryPath = path.join(__dirname, '..', '.crank', 'bin', 'crank-shot');

function ensureCaptureTool() {
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  const sourceTime = fs.statSync(sourcePath).mtimeMs;
  let binaryTime = 0;
  try {
    binaryTime = fs.statSync(binaryPath).mtimeMs;
  } catch (_) {
    binaryTime = 0;
  }
  if (binaryTime >= sourceTime) return binaryPath;
  const built = spawnSync('swiftc', ['-O', '-o', binaryPath, sourcePath], {
    encoding: 'utf8'
  });
  if (built.status !== 0) {
    throw new Error((built.stderr || 'Could not build the screen capture tool').trim());
  }
  return binaryPath;
}

function captureScreenRect(rect) {
  const x = Math.round(Number(rect && rect.x));
  const y = Math.round(Number(rect && rect.y));
  const width = Math.round(Number(rect && rect.width));
  const height = Math.round(Number(rect && rect.height));
  if (![x, y, width, height].every((n) => Number.isFinite(n))) {
    return Promise.reject(new Error('Invalid capture rectangle'));
  }
  if (width < 1 || height < 1 || width > 4000 || height > 4000) {
    return Promise.reject(new Error('Invalid capture rectangle'));
  }
  const file = path.join(os.tmpdir(), 'crank-shot-' + process.pid + '-' + Date.now() + '.png');
  return runCapture(['/usr/sbin/screencapture', '-x', '-t', 'png', '-R', [x, y, width, height].join(','), file], file);
}

function captureSelectionShot(spec) {
  const tool = ensureCaptureTool();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crank-shot-'));
  const requestPath = path.join(dir, 'request.json');
  const outPath = path.join(dir, 'shot.png');
  fs.writeFileSync(requestPath, JSON.stringify(spec));
  return runCapture([tool, outPath, requestPath], outPath).finally(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

function locateSelection(spec) {
  const tool = ensureCaptureTool();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crank-shot-'));
  const requestPath = path.join(dir, 'request.json');
  const outPath = path.join(dir, 'shot.png');
  fs.writeFileSync(requestPath, JSON.stringify(Object.assign({}, spec, { locate: true })));
  return new Promise((resolve, reject) => {
    const child = spawn(tool, [outPath, requestPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      fs.rmSync(dir, { recursive: true, force: true });
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'Screen capture failed'));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (_) {
        reject(new Error(stderr.trim() || 'Could not see the selection in the browser window'));
      }
    });
  });
}

function runCapture(command, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'Screen capture failed'));
        return;
      }
      try {
        const png = fs.readFileSync(file);
        fs.unlink(file, () => {});
        if (!png.length) {
          reject(new Error('Screen capture wrote an empty file'));
          return;
        }
        resolve(png);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function captureScreenPng(spec) {
  if (spec && spec.locate) return locateSelection(spec);
  if (spec && spec.frameWidth && spec.innerWidth) return captureSelectionShot(spec);
  return captureScreenRect(spec);
}

module.exports = { captureScreenPng, locateSelection };
