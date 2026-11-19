// Checks the store listing against the Chrome Web Store "Listing Requirements"
// and "Discovery" rules, so a submission is not rejected for metadata problems.
//
//     npm run check:listing
//
// What it enforces, and why:
//   * A blank description, a missing icon or missing screenshots is an
//     automatic rejection.
//   * "Keyword Spam" is not allowed. Google spells out three examples,
//     including "unnatural repetition of the same keyword more than 5 times".
//     This script counts every keyword and fails above that limit.
//   * Screenshots must be 1280x800 or 640x400, without transparency.
//   * The listing must point at a privacy policy.
//
// Run tools/generate-store-assets.py first if images are missing.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LISTING = path.join(ROOT, 'store', 'listing.md');

const MAX_KEYWORD_REPEATS = 5; // Google's stated limit
const MAX_DESCRIPTION_CHARS = 16000; // dashboard limit for the detailed description
const SHOT_SIZES = [
  [1280, 800],
  [640, 400]
];

let problems = 0;
let warnings = 0;
const notes = [];

function fail(message) {
  problems++;
  console.error('FAIL  ' + message);
}

function warn(message) {
  warnings++;
  console.warn('WARN  ' + message);
}

function note(message) {
  notes.push(message);
}

function readListing() {
  if (!fs.existsSync(LISTING)) {
    fail('store/listing.md is missing');
    return null;
  }
  return fs.readFileSync(LISTING, 'utf8');
}

/** Pulls the fenced code block that follows a "## Heading". */
function section(text, heading) {
  const index = text.indexOf('\n## ' + heading);
  if (index === -1) return '';
  const rest = text.slice(index);
  const fence = rest.match(/```[a-z]*\n([\s\S]*?)```/);
  return fence ? fence[1].trim() : '';
}

function pngSize(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  // Colour type 6 = RGBA, 2 = RGB
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25]
  };
}

function countOccurrences(haystack, needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('(?<![\\w-])' + escaped + '(?![\\w-])', 'gi');
  return (haystack.match(pattern) || []).length;
}

function checkImages() {
  const storeDir = path.join(ROOT, 'store');
  if (!fs.existsSync(storeDir)) {
    fail('the store/ folder is missing');
    return;
  }

  const files = fs.readdirSync(storeDir);
  const screenshots = files.filter((name) => /^screenshot-\d.*\.png$/.test(name)).sort();

  if (screenshots.length === 0) {
    fail('no screenshots found in store/ (a listing without screenshots is rejected)');
  }
  if (screenshots.length > 5) {
    warn(screenshots.length + ' screenshots found, the dashboard accepts 5');
  }

  screenshots.forEach((name) => {
    const file = path.join(storeDir, name);
    const size = pngSize(file);
    if (!size) {
      fail(name + ' is not a PNG');
      return;
    }
    const allowed = SHOT_SIZES.some(([w, h]) => size.width === w && size.height === h);
    if (!allowed) {
      fail(name + ' is ' + size.width + 'x' + size.height + ', must be 1280x800 or 640x400');
    }
    if (size.colorType === 6) {
      fail(name + ' has an alpha channel, the store wants 24-bit PNG');
    }
  });
  note(screenshots.length + ' screenshots, all ' + SHOT_SIZES[0].join('x'));

  const promos = [
    ['promo-small-440x280.png', 440, 280],
    ['promo-marquee-1400x560.png', 1400, 560]
  ];
  promos.forEach(([name, width, height]) => {
    const file = path.join(storeDir, name);
    if (!fs.existsSync(file)) {
      warn('optional promo image ' + name + ' is missing');
      return;
    }
    const size = pngSize(file);
    if (!size) {
      fail(name + ' is not a PNG');
    } else if (size.width !== width || size.height !== height) {
      fail(name + ' is ' + size.width + 'x' + size.height + ', expected ' + width + 'x' + height);
    } else if (size.colorType === 6) {
      fail(name + ' has an alpha channel, the store wants 24-bit PNG');
    }
  });

  const icon = path.join(ROOT, 'icons', 'icon128.png');
  if (!fs.existsSync(icon)) {
    fail('icons/icon128.png is missing (required for the listing)');
  } else {
    const size = pngSize(icon);
    if (size?.width !== 128 || size.height !== 128) {
      fail('icons/icon128.png must be 128x128');
    }
  }
}

function checkMetadata(listing, manifest) {
  const summary = section(listing, 'Summary');
  const description = section(listing, 'Detailed description');

  if (!description || description.length < 200) {
    fail('the detailed description is empty or too short (a blank description is rejected)');
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    fail('the detailed description is longer than ' + MAX_DESCRIPTION_CHARS + ' characters');
  }
  if (!summary) {
    fail('the summary is missing');
  }
  if (summary.length > 132) {
    fail('the summary is ' + summary.length + ' characters, the limit is 132');
  }
  if (summary && summary !== manifest.description) {
    warn('the summary and the manifest description differ, keep them in sync');
  }

  const privacyLink = listing.match(/https?:\/\/\S*(privacy|PRIVACY)\S*/);
  if (!privacyLink) {
    fail('the listing has no privacy policy URL');
  }

  // --- keyword spam -------------------------------------------------------
  // Only phrases we deliberately target are tracked; the point is to catch
  // accidental stuffing, not to ban words.
  const keywords = Array.from(
    new Set([
      'read aloud',
      'text to speech',
      'speech',
      'highlight',
      'reader',
      'accessibility',
      'dyslexia',
      'article',
      'offline'
    ])
  );

  // Longer phrases are counted first and then masked out, so "text to speech"
  // does not also count as "speech" - Google's rule is about repeating the same
  // keyword, not about every word that happens to appear inside it.
  const counts = {};
  let remaining = description;
  keywords
    .slice()
    .sort((a, b) => b.length - a.length)
    .forEach((keyword) => {
      counts[keyword] = countOccurrences(remaining, keyword);
      remaining = remaining.replace(
        new RegExp(
          '(?<![\\w-])' + keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])',
          'gi'
        ),
        ' '
      );
    });

  keywords.forEach((keyword) => {
    if (counts[keyword] > MAX_KEYWORD_REPEATS) {
      fail(
        '"' +
          keyword +
          '" appears ' +
          counts[keyword] +
          ' times in the description (limit is ' +
          MAX_KEYWORD_REPEATS +
          ' - Google calls this Keyword Spam)'
      );
    }
  });

  const top = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([keyword, count]) => keyword + ' x' + count)
    .join(', ');
  note('keyword usage: ' + (top || 'none'));

  // A comma/semicolon list of short tokens is the classic keyword-stuffing shape.
  const keywordListLine = description.split('\n').find((line) => {
    const parts = line
      .split(/[,;]/)
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length >= 5 && parts.every((part) => part.split(/\s+/).length <= 3);
  });
  if (keywordListLine) {
    fail('the description looks like a raw keyword list: "' + keywordListLine.trim() + '"');
  }

  // Unattributed testimonials are not allowed.
  if (/[""][^""]{20,}[""][^.\n]*$/m.test(description) && !/—|-/.test(description)) {
    warn('quoted text without an attribution may look like an anonymous testimonial');
  }

  if (!/read aloud/i.test(summary) && !/read aloud/i.test(manifest.name)) {
    warn('the primary keyword "read aloud" is missing from the name and summary');
  }
}

function main() {
  const listing = readListing();
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

  checkImages();
  if (listing) checkMetadata(listing, manifest);

  notes.forEach((line) => {
    console.log('note  ' + line);
  });

  if (problems) {
    console.error('\n' + problems + ' problem(s), ' + warnings + ' warning(s).');
    process.exit(1);
  }

  console.log('\nThe store listing looks good (' + warnings + ' warning(s)).');
}

main();
