// Runs every test file in a single Node process.
//
//     npm test
//
// `node --test test/` would spawn a child process per file, which is slower and
// is not allowed in every environment. Requiring the files keeps the whole
// suite in one process while still using the built-in node:test reporter.
// Include a delay (`npm test -- 1500`) only when debugging timing issues.

require('../test/core.test.js');
require('../test/content.test.js');
require('../test/popup.test.js');
