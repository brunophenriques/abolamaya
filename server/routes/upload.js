const router   = require('express').Router();
const multer   = require('multer');
const sharp    = require('sharp');
const path     = require('path');
const fs       = require('fs');
const db       = require('../db');
const { auth } = require('../middleware/auth');

// Store uploads in memory so sharp can process before saving to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Só são permitidos ficheiros de imagem'));
    }
    cb(null, true);
  },
});

const AVATAR_DIR = path.join(__dirname, '..', '..', 'img', 'avatars');
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

// POST /api/upload/avatar
router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum ficheiro enviado' });

  const filename = `${req.user.id}.jpg`;
  const filepath = path.join(AVATAR_DIR, filename);

  try {
    await sharp(req.file.buffer)
      .resize(200, 200, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 85 })
      .toFile(filepath);

    const avatarUrl = `/img/avatars/${filename}?v=${Date.now()}`;
    db.prepare('UPDATE users SET avatar_url=? WHERE id=?').run(avatarUrl.split('?')[0], req.user.id);

    res.json({ ok: true, avatar_url: avatarUrl });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao processar imagem: ' + err.message });
  }
});

// DELETE /api/upload/avatar — revert to generated avatar
router.delete('/avatar', auth, (req, res) => {
  const filepath = path.join(AVATAR_DIR, `${req.user.id}.jpg`);
  try { fs.unlinkSync(filepath); } catch { /* already gone */ }
  db.prepare('UPDATE users SET avatar_url=NULL WHERE id=?').run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
