// Checks the extension before it is zipped for the Chrome Web Store.
//
//     npm run check
//
// It fails (exit code 1) on anything that would make Chrome or the review
// process reject the package: bad manifest fields, missing files, icons with
// the wrong size, inline scripts (blocked by the Manifest V3 CSP), remote code,
// eval usage or invalid JavaScript.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const MAX_NAME_LENGTH = 45;
const MAX_DESCRIPTION_LENGTH = 132;
const REQUIRED_ICON_SIZES = [16, 48, 128];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function exists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

function pngSize(file) {
  const buffer = fs.readFileSync(path.join(ROOT, file));
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** #rrggbb -> relative luminance, per WCAG 2.1. */
function luminance(hex) {
  const value = hex.replace('#', '').trim();
  const full =
    value.length === 3
      ? value
          .split('')
          .map((character) => character + character)
          .join('')
      : value;
  const channels = [0, 2, 4].map(
    (offset) => Number.parseInt(full.slice(offset, offset + 2), 16) / 255
  );
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG contrast ratio between two #rrggbb colours. */
function contrastRatio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseCssVariables(block) {
  const variables = {};
  for (const match of block.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8})\s*;/gi)) {
    variables[match[1]] = match[2];
  }
  return variables;
}

/**
 * Reads the popup's theme variables and returns both palettes. The popup must
 * stay readable, so the colours are checked instead of trusted.
 */
function popupPalettes(html) {
  const lightMatch = html.match(/:root\s*\{([^}]*)\}/);
  const darkMatch = html.match(
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/
  );
  return {
    light: lightMatch ? parseCssVariables(lightMatch[1]) : {},
    dark: darkMatch ? parseCssVariables(darkMatch[1]) : null
  };
}

// Every pair the user actually reads, with the minimum ratio WCAG AA asks for.
// 4.5:1 is the threshold for normal text.
const CONTRAST_PAIRS = [
  ['text', 'bg', 4.5],
  ['muted', 'bg', 4.5],
  ['on-accent', 'read', 4.5],
  ['on-accent', 'pause', 4.5],
  ['on-accent', 'stop', 4.5],
  ['disabled-text', 'disabled-bg', 4.5],
  ['status-reading-text', 'status-reading-bg', 4.5],
  ['status-paused-text', 'status-paused-bg', 4.5],
  ['status-stopped-text', 'status-stopped-bg', 4.5],
  ['hint-text', 'hint-bg', 4.5],
  ['warning-text', 'warning-bg', 4.5]
];

function collectJsFiles(manifest) {
  const files = new Set();

  if (manifest.background?.service_worker) {
    files.add(manifest.background.service_worker);
  }
  (manifest.content_scripts || []).forEach((entry) => {
    (entry.js || []).forEach((file) => {
      files.add(file);
    });
  });

  // Scripts referenced by the popup
  const popup = manifest.action?.default_popup;
  if (popup && exists(popup)) {
    const html = read(popup);
    for (const match of html.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)) {
      files.add(match[1]);
    }
  }

  return Array.from(files).filter((file) => file.endsWith('.js'));
}

function verify() {
  const problems = [];
  const notes = [];

  // --- manifest -------------------------------------------------------------

  if (!exists('manifest.json')) {
    problems.push('manifest.json is missing');
    return { problems, notes };
  }

  let manifest;
  try {
    manifest = JSON.parse(read('manifest.json'));
  } catch (error) {
    problems.push('manifest.json is not valid JSON: ' + error.message);
    return { problems, notes };
  }

  if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');

  if (!manifest.name) {
    problems.push('manifest "name" is required');
  } else if (manifest.name.length > MAX_NAME_LENGTH) {
    problems.push(
      'manifest "name" is ' + manifest.name.length + ' characters, allowed: ' + MAX_NAME_LENGTH
    );
  }

  if (!manifest.description) {
    problems.push('manifest "description" is required');
  } else if (manifest.description.length > MAX_DESCRIPTION_LENGTH) {
    problems.push(
      'manifest "description" is ' +
        manifest.description.length +
        ' characters, allowed: ' +
        MAX_DESCRIPTION_LENGTH
    );
  }

  if (!/^\d+(\.\d+){0,3}$/.test(manifest.version || '')) {
    problems.push('manifest "version" must be 1 to 4 dot separated numbers');
  }

  if (manifest.short_name && manifest.short_name.length > 12) {
    problems.push('manifest "short_name" must be 12 characters or fewer');
  }

  // --- Manifest V3 technical requirements -----------------------------------

  // The MV3 requirement is that the whole functionality is readable from the
  // package, so the CSP must stay restrictive.
  const csp = manifest.content_security_policy?.extension_pages;
  if (!csp) {
    notes.push(
      'content_security_policy.extension_pages is not declared explicitly (Chrome then applies the default)'
    );
  } else {
    ['unsafe-eval', 'unsafe-inline', 'wasm-unsafe-eval', 'http:', 'https:'].forEach((token) => {
      if (csp.includes(token)) {
        problems.push('content_security_policy must not allow ' + token + ': ' + csp);
      }
    });
  }

  const minVersion = parseInt(manifest.minimum_chrome_version, 10);
  if (manifest.minimum_chrome_version && !/^\d+$/.test(manifest.minimum_chrome_version)) {
    problems.push('minimum_chrome_version must be a plain Chrome version number');
  }

  (manifest.content_scripts || []).forEach((entry, index) => {
    if (entry.world && entry.world !== 'ISOLATED' && entry.world !== 'MAIN') {
      problems.push('content_scripts[' + index + '].world must be ISOLATED or MAIN');
    }
    if (entry.world === 'MAIN' && minVersion && minVersion < 111) {
      problems.push('content_scripts[' + index + '].world requires minimum_chrome_version 111');
    }
    if (entry.matches?.includes('<all_urls>')) {
      notes.push(
        'content_scripts[' +
          index +
          '] runs on <all_urls> with world "' +
          (entry.world || 'ISOLATED') +
          '"'
      );
    }
  });

  if (manifest.content_security_policy?.sandbox) {
    notes.push('a sandbox CSP is declared: keep sandboxed pages logic-free');
  }

  // Localised strings only work when default_locale and _locales agree.
  const manifestSource = read('manifest.json');
  const placeholders = Array.from(manifestSource.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)).map(
    (match) => match[1]
  );

  if (placeholders.length > 0) {
    if (!manifest.default_locale) {
      problems.push('the manifest uses __MSG_ placeholders but has no default_locale');
    } else {
      const localeFile = path.join('_locales', manifest.default_locale, 'messages.json');
      if (!exists(localeFile)) {
        problems.push('default_locale is set but ' + localeFile + ' is missing');
      } else {
        let messages = {};
        try {
          messages = JSON.parse(read(localeFile));
        } catch (error) {
          problems.push(localeFile + ' is not valid JSON: ' + error.message);
        }
        placeholders.forEach((name) => {
          if (!messages[name]?.message) {
            problems.push(
              localeFile + ' is missing the "' + name + '" message used by the manifest'
            );
          }
        });
      }
    }
  } else if (manifest.default_locale) {
    problems.push('default_locale is set but nothing in the manifest is localised');
  }

  // MV3 requires a matches list on every web accessible resource entry.
  (manifest.web_accessible_resources || []).forEach((entry, index) => {
    if (!entry.matches || entry.matches.length === 0) {
      problems.push('web_accessible_resources[' + index + '] needs a matches list in MV3');
    }
  });

  // --- referenced files -----------------------------------------------------

  const icons = manifest.icons || {};
  REQUIRED_ICON_SIZES.forEach((size) => {
    const file = icons[String(size)];
    if (!file) {
      problems.push('icons["' + size + '"] is required');
      return;
    }
    if (!exists(file)) {
      problems.push('icon file ' + file + ' is missing');
      return;
    }
    const dimensions = pngSize(file);
    if (!dimensions) {
      problems.push(file + ' is not a PNG file');
    } else if (dimensions.width !== size || dimensions.height !== size) {
      problems.push(
        file +
          ' is ' +
          dimensions.width +
          'x' +
          dimensions.height +
          ' but the manifest declares ' +
          size +
          'x' +
          size
      );
    }
  });

  if (manifest.action?.default_popup) {
    if (!exists(manifest.action.default_popup)) {
      problems.push('popup ' + manifest.action.default_popup + ' is missing');
    }
  } else {
    problems.push('action.default_popup is required for this extension');
  }

  (manifest.content_scripts || []).forEach((entry, index) => {
    (entry.js || []).forEach((file) => {
      if (!exists(file))
        problems.push('content_scripts[' + index + '].js references missing ' + file);
    });
    (entry.css || []).forEach((file) => {
      if (!exists(file))
        problems.push('content_scripts[' + index + '].css references missing ' + file);
    });
  });

  if (manifest.background?.service_worker) {
    if (!exists(manifest.background.service_worker)) {
      problems.push(
        'background service worker ' + manifest.background.service_worker + ' is missing'
      );
    }
  } else {
    problems.push('background.service_worker is required in Manifest V3');
  }

  // --- script safety --------------------------------------------------------

  const jsFiles = collectJsFiles(manifest);

  jsFiles.forEach((file) => {
    if (!exists(file)) {
      problems.push(file + ' is referenced but missing');
      return;
    }
    const source = read(file);

    try {
      new vm.Script(source, { filename: file });
    } catch (error) {
      problems.push(file + ' has a syntax error: ' + error.message);
    }

    if (/\beval\s*\(/.test(source)) problems.push(file + ' uses eval(), which Chrome forbids');
    if (/new\s+Function\s*\(/.test(source)) {
      problems.push(file + ' uses new Function(), which the Web Store rejects');
    }
  });

  // --- popup markup ---------------------------------------------------------

  const popupFile = manifest.action?.default_popup;
  if (popupFile && exists(popupFile)) {
    const html = read(popupFile);

    if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) {
      problems.push(popupFile + ' contains an inline <script>, which the MV3 CSP blocks');
    }
    if (/\son\w+\s*=\s*["']/i.test(html)) {
      problems.push(popupFile + ' contains an inline event handler such as onclick');
    }
    if (/<script[^>]+src=["'](https?:)?\/\//i.test(html)) {
      problems.push(popupFile + ' loads a script from another origin');
    }

    // --- readability --------------------------------------------------------
    const palettes = popupPalettes(html);

    if (Object.keys(palettes.light).length === 0) {
      problems.push(popupFile + ' does not define its colours as CSS variables in :root');
    }
    if (palettes.dark === null) {
      notes.push(popupFile + ' has no dark theme (prefers-color-scheme: dark)');
    }

    // The dark block only overrides some variables; CSS inherits the rest from
    // :root, so the check has to do the same.
    const themes = [
      ['light', palettes.light],
      ['dark', palettes.dark ? Object.assign({}, palettes.light, palettes.dark) : null]
    ];

    themes.forEach(([theme, palette]) => {
      if (!palette) return;

      const measured = [];
      CONTRAST_PAIRS.forEach(([foreground, background, minimum]) => {
        const fg = palette[foreground];
        const bg = palette[background];

        if (!fg || !bg) {
          problems.push(
            popupFile + ' ' + theme + ' theme is missing --' + foreground + ' or --' + background
          );
          return;
        }

        const ratio = contrastRatio(fg, bg);
        if (ratio < minimum) {
          problems.push(
            popupFile +
              ' ' +
              theme +
              ' theme: ' +
              foreground +
              ' on ' +
              background +
              ' is only ' +
              ratio.toFixed(2) +
              ':1, needs ' +
              minimum +
              ':1'
          );
        }
        measured.push(foreground + '/' + background + '=' + ratio.toFixed(1) + ':1');
      });

      if (measured.length > 0) {
        notes.push(popupFile + ' ' + theme + ' contrast: ' + measured.join(' '));
      }
    });
  }

  // --- notes ----------------------------------------------------------------

  const hosts = manifest.host_permissions || [];
  if (hosts.includes('<all_urls>')) {
    notes.push(
      'host_permissions includes <all_urls>: justify it in the "Permission justification" field'
    );
  }
  if ((manifest.permissions || []).includes('activeTab')) {
    notes.push('activeTab is requested: it is used to read pages without host access');
  }
  notes.push('scripts included: ' + jsFiles.join(', '));

  return { problems, notes };
}

function main() {
  const result = verify();

  result.notes.forEach((note) => {
    console.log('note  ' + note);
  });
  result.problems.forEach((problem) => {
    console.error('FAIL  ' + problem);
  });

  if (result.problems.length) {
    console.error('\n' + result.problems.length + ' problem(s) found.');
    process.exit(1);
  }

  console.log('\nThe extension package looks good.');
}

if (require.main === module) main();

module.exports = { verify: verify, ROOT: ROOT };
