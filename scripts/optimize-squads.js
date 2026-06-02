// Optimize squad player photos: resize to 280×373 (3:4), JPEG quality 80
// Run: npm run optimize-squads
//
// Requires: npm install  (sharp is in devDependencies)

const sharp  = require('sharp');
const fs     = require('fs');
const path   = require('path');

const SQUADS_DIR = path.join(__dirname, '..', 'img', 'squads');
const WIDTH      = 280;
const HEIGHT     = 373;
const QUALITY    = 80;
const EXTS       = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

async function optimizeFile(filePath) {
  const ext  = path.extname(filePath).toLowerCase();
  if (!EXTS.has(ext)) return null;

  const originalSize = fs.statSync(filePath).size;

  // Read → resize (cover = crop to fill, gravity north = keep face at top)
  // → convert to JPEG and overwrite
  const tmpPath = filePath + '.tmp';
  await sharp(filePath)
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'top' })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toFile(tmpPath);

  fs.renameSync(tmpPath, filePath.replace(/\.(jpeg|png|webp|avif)$/i, '.jpg'));
  if (ext !== '.jpg') fs.unlinkSync(filePath);  // remove original if renamed

  const newSize = fs.statSync(filePath.replace(/\.(jpeg|png|webp|avif)$/i, '.jpg')).size;
  return { originalSize, newSize };
}

async function run() {
  if (!fs.existsSync(SQUADS_DIR)) {
    console.error('Pasta img/squads/ não encontrada.');
    process.exit(1);
  }

  const teams = fs.readdirSync(SQUADS_DIR).filter(d =>
    fs.statSync(path.join(SQUADS_DIR, d)).isDirectory()
  );

  if (!teams.length) {
    console.log('Nenhuma pasta de seleção encontrada em img/squads/');
    return;
  }

  let totalOriginal = 0, totalNew = 0, count = 0;

  for (const team of teams.sort()) {
    const teamDir = path.join(SQUADS_DIR, team);
    const files   = fs.readdirSync(teamDir);
    let teamSaved = 0;

    process.stdout.write(`\n📁 ${team} (${files.length} ficheiros)\n`);

    for (const file of files.sort()) {
      const filePath = path.join(teamDir, file);
      try {
        const result = await optimizeFile(filePath);
        if (!result) continue;
        const saved = result.originalSize - result.newSize;
        const pct   = Math.round((saved / result.originalSize) * 100);
        process.stdout.write(`   ${file.padEnd(32)} ${kb(result.originalSize)} → ${kb(result.newSize)}  (-${pct}%)\n`);
        totalOriginal += result.originalSize;
        totalNew      += result.newSize;
        teamSaved     += saved;
        count++;
      } catch (e) {
        process.stdout.write(`   ${file.padEnd(32)} ERRO: ${e.message}\n`);
      }
    }
    if (teamSaved > 0) process.stdout.write(`   Poupado: ${kb(teamSaved)}\n`);
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`${count} imagens optimizadas`);
  console.log(`Antes:  ${kb(totalOriginal)}   Depois: ${kb(totalNew)}   Poupado: ${kb(totalOriginal - totalNew)} (${Math.round(((totalOriginal-totalNew)/totalOriginal)*100)}%)`);
}

function kb(bytes) {
  if (bytes > 1_000_000) return (bytes / 1_000_000).toFixed(1) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

run().catch(err => { console.error(err); process.exit(1); });
