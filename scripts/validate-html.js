const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR } = require('../server/paths');

const htmlFiles = fs.readdirSync(PUBLIC_DIR)
  .filter(name => name.endsWith('.html'))
  .sort();

const errors = [];
const assetPattern = /(?:href|src)=["']([^"']+)["']/g;
const inlineScriptPattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

for (const file of htmlFiles) {
  const filePath = path.join(PUBLIC_DIR, file);
  const html = fs.readFileSync(filePath, 'utf8');

  for (const match of html.matchAll(assetPattern)) {
    const rawUrl = match[1];
    if (
      rawUrl.includes('${') ||
      /^(?:https?:|data:|mailto:|javascript:|#)/.test(rawUrl)
    ) {
      continue;
    }

    const cleanUrl = rawUrl.split(/[?#]/, 1)[0];
    const extension = path.extname(cleanUrl);
    if (!extension && !/^(?:css|js|img|data)\//.test(cleanUrl)) continue;

    const relativePath = cleanUrl.startsWith('/')
      ? cleanUrl.slice(1)
      : path.join(path.dirname(file), cleanUrl);
    const assetPath = path.resolve(PUBLIC_DIR, relativePath);

    if (!assetPath.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(assetPath)) {
      errors.push(`${file}: missing asset: ${rawUrl}`);
    }
  }

  let scriptIndex = 0;
  for (const match of html.matchAll(inlineScriptPattern)) {
    scriptIndex += 1;
    try {
      new Function(match[1]);
    } catch (error) {
      errors.push(`${file}: inline script ${scriptIndex}: ${error.message}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`HTML OK: ${htmlFiles.length} pages and their assets validated.`);
