// Builds everything that goes into dist/.
//
//     npm run build            # both artifacts
//     npm run build:zip        # only the upload zip
//     npm run build:unpacked   # only the loadable folder
//     npm run create           # clean dist/ first, then build both
//
// Artifacts:
//   dist/unpacked/                              load this folder with
//                                               "Load unpacked" in Chrome
//   dist/read-aloud-with-highlight-v1.0.0.zip   upload this to the store
//
// Only the files the extension needs at runtime are packed, so the package
// stays small and the review has less to read. The zip is written with Node's
// own zlib, so no dependency or external zip tool is required.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { verify, ROOT } = require('./verify');

const DIST = path.join(ROOT, 'dist');
const UNPACKED = path.join(DIST, 'unpacked');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const ZIP_NAME = 'read-aloud-with-highlight-v' + manifest.version + '.zip';

const args = process.argv.slice(2);
const withZip = !args.includes('--no-zip');
const withUnpacked = !args.includes('--no-unpacked');

// --- CRC32 ------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

// --- zip writer -------------------------------------------------------------

function dosDateTime(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, date: day & 0xffff };
}

function createZip(entries, now) {
  const chunks = [];
  const central = [];
  const stamp = dosDateTime(now);
  let offset = 0;

  entries.forEach((entry) => {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const raw = fs.readFileSync(entry.absolute);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const payload = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const checksum = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 file names
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(stamp.time, 10);
    localHeader.writeUInt16LE(stamp.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    chunks.push(localHeader, nameBuffer, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(stamp.time, 12);
    centralHeader.writeUInt16LE(stamp.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra
    centralHeader.writeUInt16LE(0, 32); // comment
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attributes
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attributes
    centralHeader.writeUInt32LE(offset, 42);

    central.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + payload.length;
  });

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuffer, end]);
}

/** Minimal reader, used to double check what this script just wrote. */
function readZipEntries(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  const endOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset === -1) throw new Error('no end of central directory record found');

  const total = buffer.readUInt16LE(endOffset + 10);
  let cursor = buffer.readUInt32LE(endOffset + 16);
  const names = [];

  for (let i = 0; i < total; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('bad central directory entry');
    const nameLength = buffer.readUInt16LE(cursor + 28);
    names.push(buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'));
    cursor += 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }

  return names;
}

// --- file list --------------------------------------------------------------

function collectFiles() {
  const files = new Set(['manifest.json', 'LICENSE']);

  Object.values(manifest.icons || {}).forEach((file) => {
    files.add(file);
  });

  if (manifest.action) {
    if (manifest.action.default_popup) {
      files.add(manifest.action.default_popup);

      // Anything the popup loads itself (scripts and styles) must ship too.
      const popupHtml = fs.readFileSync(path.join(ROOT, manifest.action.default_popup), 'utf8');
      const references = popupHtml.matchAll(/<(script|link)[^>]*?(?:src|href)=["']([^"']+)["']/gi);
      for (const match of references) {
        const reference = match[2];
        if (!/^(https?:)?\/\//i.test(reference) && !reference.startsWith('data:')) {
          files.add(reference.replace(/^\.\//, ''));
        }
      }
    }

    Object.values(manifest.action.default_icon || {}).forEach((file) => {
      files.add(file);
    });
  }

  if (manifest.background?.service_worker) {
    files.add(manifest.background.service_worker);
  }

  (manifest.content_scripts || []).forEach((entry) => {
    (entry.js || []).forEach((file) => {
      files.add(file);
    });
    (entry.css || []).forEach((file) => {
      files.add(file);
    });
  });

  return Array.from(files).sort();
}

function toEntry(file) {
  return {
    name: file.split(path.sep).join('/'),
    absolute: path.join(ROOT, file)
  };
}

/**
 * Copies the runtime files into dist/unpacked so the folder can be loaded
 * directly with "Load unpacked" in chrome://extensions.
 */
function writeUnpacked(entries) {
  // Safety: only ever delete inside dist/, and never a symlinked path.
  const target = path.resolve(UNPACKED);
  if (!target.startsWith(path.resolve(DIST) + path.sep)) {
    throw new Error('refusing to clean a folder outside dist/: ' + target);
  }
  fs.rmSync(target, { recursive: true, force: true });

  entries.forEach((entry) => {
    const destination = path.join(UNPACKED, entry.name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(entry.absolute, destination);
  });

  return target;
}

// --- main -------------------------------------------------------------------

function main() {
  const result = verify();
  result.problems.forEach((problem) => {
    console.error('FAIL  ' + problem);
  });
  if (result.problems.length) {
    console.error('\nFix the problems above before building.');
    process.exit(1);
  }

  const files = collectFiles();
  const missing = files.filter((file) => !fs.existsSync(path.join(ROOT, file)));
  if (missing.length) {
    console.error('These files are referenced by the manifest but missing: ' + missing.join(', '));
    process.exit(1);
  }

  fs.mkdirSync(DIST, { recursive: true });
  const entries = files.map(toEntry);

  console.log('Packed ' + entries.length + ' runtime files:');
  entries.forEach((entry) => {
    console.log('  ' + entry.name);
  });

  if (withUnpacked) {
    const folder = writeUnpacked(entries);
    console.log('\nLoadable build: ' + path.relative(ROOT, folder));
    console.log('  Load it with "Load unpacked" in chrome://extensions');
  }

  if (withZip) {
    const zipPath = path.join(DIST, ZIP_NAME);
    fs.writeFileSync(zipPath, createZip(entries, new Date()));

    const written = readZipEntries(zipPath);
    if (written.length !== entries.length) {
      console.error(
        'The zip contains ' + written.length + ' entries but ' + entries.length + ' were expected'
      );
      process.exit(1);
    }

    const sizeKb = (fs.statSync(zipPath).size / 1024).toFixed(1);
    console.log('\nStore upload: ' + path.relative(ROOT, zipPath) + ' (' + sizeKb + ' KB)');
    console.log('  Upload it at https://chrome.google.com/webstore/devconsole');
  }
}

main();
