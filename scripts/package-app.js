#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const shouldBuild = !args.includes('--skip-build');
const builderArgs = args.filter((arg) => arg !== '--skip-build');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function quoteWindowsArg(value) {
  if (value.length === 0) {
    return '""';
  }

  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

function run(command, commandArgs, options = {}) {
  const spawnOptions = {
    cwd: projectRoot,
    stdio: 'inherit',
    ...options
  };

  const result =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [command, ...commandArgs].map(quoteWindowsArg).join(' ')], spawnOptions)
      : spawnSync(command, commandArgs, spawnOptions);

  if (result.error) {
    console.error(`Failed to run command: ${command} ${commandArgs.join(' ')}`);
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function findPackageJson(dependency, fromDir) {
  const segments = dependency.split('/');
  let currentDir = fs.realpathSync(fromDir);

  while (true) {
    const candidate = path.join(currentDir, 'node_modules', ...segments, 'package.json');
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function isWorkspaceSpec(spec) {
  return spec.startsWith('workspace:') || spec.startsWith('file:') || spec.startsWith('link:');
}

function isStageWorkspacePackage(packageJsonPath, stageDir) {
  const relativePath = path.relative(stageDir, packageJsonPath);
  return relativePath !== '' && !relativePath.startsWith('..') && relativePath.split(path.sep)[0] === 'packages';
}

function toFileDependencySpec(packageJsonPath, stageDir) {
  const packageDir = path.dirname(packageJsonPath);
  let relativePath = path.relative(stageDir, packageDir).split(path.sep).join('/');
  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }
  return `file:${relativePath}`;
}

function collectProductionDependencies(rootDir) {
  const rootPackage = readJson(path.join(rootDir, 'package.json'));
  const rootDependencySpecs = new Map(Object.entries(rootPackage.dependencies ?? {}));
  const queue = Object.keys(rootPackage.dependencies ?? {}).map((dependency) => ({
    dependency,
    fromDir: rootDir
  }));
  const visited = new Set();
  const missing = [];
  const resolvedDependencies = new Map();

  while (queue.length > 0) {
    const current = queue.shift();

    const packageJsonPath = findPackageJson(current.dependency, current.fromDir);
    if (!packageJsonPath) {
      missing.push({
        dependency: current.dependency,
        fromDir: current.fromDir
      });
      continue;
    }

    if (visited.has(packageJsonPath)) {
      continue;
    }
    visited.add(packageJsonPath);

    const packageJson = readJson(packageJsonPath);
    const packageDir = path.dirname(packageJsonPath);
    const rootSpec = rootDependencySpecs.get(packageJson.name);

    if (!resolvedDependencies.has(packageJson.name)) {
      if (rootSpec && isWorkspaceSpec(rootSpec)) {
        resolvedDependencies.set(packageJson.name, rootSpec);
      } else if (isStageWorkspacePackage(packageJsonPath, rootDir)) {
        resolvedDependencies.set(packageJson.name, toFileDependencySpec(packageJsonPath, rootDir));
      } else {
        resolvedDependencies.set(packageJson.name, packageJson.version);
      }
    }

    for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
      queue.push({
        dependency,
        fromDir: packageDir
      });
    }
  }

  if (missing.length > 0) {
    const details = missing
      .map(({ dependency, fromDir }) => `- ${dependency} (required from ${path.relative(rootDir, fromDir) || '.'})`)
      .join(os.EOL);

    throw new Error(`生产依赖目录存在缺失依赖，已中止打包：${os.EOL}${details}`);
  }

  return Object.fromEntries(
    Array.from(resolvedDependencies.entries()).sort(([left], [right]) => left.localeCompare(right))
  );
}

function syncWorkspaceBuildArtifacts(stageDir) {
  const sourcePackagesDir = path.join(projectRoot, 'packages');
  const targetPackagesDir = path.join(stageDir, 'packages');

  if (!fs.existsSync(sourcePackagesDir) || !fs.existsSync(targetPackagesDir)) {
    return;
  }

  for (const entry of fs.readdirSync(targetPackagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sourceDistDir = path.join(sourcePackagesDir, entry.name, 'dist');
    const targetDistDir = path.join(targetPackagesDir, entry.name, 'dist');

    if (!fs.existsSync(sourceDistDir)) {
      continue;
    }

    fs.cpSync(sourceDistDir, targetDistDir, {
      force: true,
      recursive: true
    });
  }
}

function prepareDeployDirectory() {
  const tempRoot = path.join(projectRoot, '.tmp');
  const stageRoot = path.join(tempRoot, 'packaged-app');
  const lockfilePath = path.join(projectRoot, 'pnpm-lock.yaml');

  fs.mkdirSync(tempRoot, { recursive: true });
  const stageDir = fs.mkdtempSync(`${stageRoot}-`);

  run(pnpmCommand, ['--filter', '.', 'deploy', '--legacy', '--prod', stageDir]);

  if (fs.existsSync(lockfilePath)) {
    fs.copyFileSync(lockfilePath, path.join(stageDir, 'pnpm-lock.yaml'));
  }

  syncWorkspaceBuildArtifacts(stageDir);

  const packageJsonPath = path.join(stageDir, 'package.json');
  const packageJson = readJson(packageJsonPath);
  const electronPackageJson = readJson(path.join(projectRoot, 'node_modules', 'electron', 'package.json'));

  packageJson.build = packageJson.build ?? {};
  packageJson.build.directories = packageJson.build.directories ?? {};
  packageJson.build.directories.output = path.join(projectRoot, 'release', '${version}');
  packageJson.build.electronVersion = electronPackageJson.version;
  packageJson.dependencies = collectProductionDependencies(stageDir);

  writeJson(packageJsonPath, packageJson);
  run(pnpmCommand, ['install', '--prod', '--ignore-scripts', '--no-frozen-lockfile'], { cwd: stageDir });

  return stageDir;
}

if (shouldBuild) {
  run(pnpmCommand, ['run', 'build']);
}

const stageDir = prepareDeployDirectory();
run(pnpmCommand, ['exec', 'electron-builder', '--projectDir', stageDir, ...builderArgs]);
