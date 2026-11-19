// Removes the build output.
//
//     npm run clean
//
// Only dist/ inside this repository is ever touched.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(ROOT, 'dist');

if (!DIST.startsWith(path.resolve(ROOT) + path.sep)) {
  console.error('Refusing to clean a folder outside the repository: ' + DIST);
  process.exit(1);
}

if (!fs.existsSync(DIST)) {
  console.log('Nothing to clean: ' + path.relative(ROOT, DIST) + ' does not exist');
  process.exit(0);
}

const removed = fs.readdirSync(DIST).length;
fs.rmSync(DIST, { recursive: true, force: true });
console.log('Removed ' + path.relative(ROOT, DIST) + ' (' + removed + ' entries)');
