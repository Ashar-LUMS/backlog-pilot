const { execSync } = require('child_process');

const run = (command) => {
  execSync(command, { stdio: 'inherit', env: process.env });
};

run('npm install --workspace client --include=optional --force --production=false');

if (process.platform === 'linux') {
  try {
    run('npm install --workspace client @rollup/rollup-linux-x64-gnu --no-save --production=false');
  } catch (error) {
    console.warn('Optional rollup native build install failed; continuing with JS fallback.', error.message);
  }
}

run('npm run build --workspace client');
