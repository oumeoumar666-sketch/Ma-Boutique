const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const MAX_IMAGE_MB = Number(process.env.MAX_IMAGE_MB || 5);
const ADMIN_KEY = process.env.ADMIN_KEY || '';

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ success: false, message: 'Accès administrateur refusé.' });
  }
  next();
}


const dataDir = path.join(__dirname, 'data');
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, 'ma_boutique_marketplace.db'));
db.pragma('journal_mode = WAL');
db.prepare(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price REAL NOT NULL,
    digital INTEGER NOT NULL DEFAULT 0,
    download_url TEXT DEFAULT '',
    seller TEXT NOT NULL,
    seller_whatsapp TEXT NOT NULL,
    image_url TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    featured_until TEXT,
    feature_requested INTEGER NOT NULL DEFAULT 0
  )
`).run();

// Migrations for existing databases
for (const statement of [
  `ALTER TABLE products ADD COLUMN featured_until TEXT`,
  `ALTER TABLE products ADD COLUMN feature_requested INTEGER NOT NULL DEFAULT 0`,
]) {
  try { db.prepare(statement).run(); } catch (_) {}
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(uploadDir, { maxAge: '7d' }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
});

app.get('/', (_req, res) => {
  res.json({ success: true, message: 'Serveur Ma Boutique fonctionne !' });
});

app.get('/api/products', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, name, description, price, digital,
           download_url AS downloadUrl,
           seller, seller_whatsapp AS sellerWhatsApp,
           image_url AS imageUrl, stock, created_at AS createdAt,
           featured_until AS featuredUntil,
           feature_requested AS featureRequested
    FROM products
    ORDER BY datetime(created_at) DESC
  `).all();
  res.json({ success: true, products: rows });
});

app.post('/api/products', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'La photo du produit est obligatoire.' });
    }

    const { name, description = '', price, digital = 'false', downloadUrl = '', seller, sellerWhatsApp, stock = '1' } = req.body;
    const numericPrice = Number(price);
    const numericStock = Math.max(0, Number.parseInt(stock, 10) || 0);
    const isDigital = digital === 'true' || digital === '1';

    if (!name || !seller || !sellerWhatsApp || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Informations du produit invalides.' });
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const imageUrl = `${PUBLIC_BASE_URL}/uploads/${encodeURIComponent(req.file.filename)}`;
    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO products
      (id, name, description, price, digital, download_url, seller, seller_whatsapp, image_url, stock, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), description.trim(), numericPrice, isDigital ? 1 : 0, downloadUrl.trim(), seller.trim(), sellerWhatsApp.replace(/\D/g, ''), imageUrl, numericStock, createdAt);

    res.status(201).json({
      success: true,
      product: { id, name: name.trim(), description: description.trim(), price: numericPrice, digital: isDigital, downloadUrl: downloadUrl.trim(), seller: seller.trim(), sellerWhatsApp: sellerWhatsApp.replace(/\D/g, ''), imageUrl, stock: numericStock, createdAt, featuredUntil: null, featureRequested: 0 }
    });
  } catch (error) {
    console.error(error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: 'Erreur serveur lors de la publication.' });
  }
});



app.post('/api/products/:id/feature-request', (req, res) => {
  try {
    const { seller } = req.body;
    if (!seller) return res.status(400).json({ success: false, message: 'Vendeur manquant.' });
    const result = db.prepare(`UPDATE products SET feature_requested = 1 WHERE id = ? AND seller = ?`).run(req.params.id, seller.trim());
    if (!result.changes) return res.status(404).json({ success: false, message: 'Produit introuvable.' });
    res.json({ success: true, pending: true, message: 'Demande de mise en avant enregistrée.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur lors de la demande.' });
  }
});

app.get('/api/admin/feature-requests', requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT id, name, seller, price, image_url AS imageUrl,
           feature_requested AS featureRequested,
           featured_until AS featuredUntil
    FROM products
    WHERE feature_requested = 1
    ORDER BY datetime(created_at) DESC
  `).all();
  res.json({ success: true, requests: rows });
});

app.post('/api/admin/feature-requests/:id/approve', requireAdmin, (req, res) => {
  try {
    const days = Number.parseInt(req.body.days, 10);
    if (![3, 7, 30].includes(days)) {
      return res.status(400).json({ success: false, message: 'Durée invalide.' });
    }
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const result = db.prepare(`
      UPDATE products
      SET feature_requested = 0, featured_until = ?
      WHERE id = ?
    `).run(until, req.params.id);
    if (!result.changes) return res.status(404).json({ success: false, message: 'Produit introuvable.' });
    res.json({ success: true, featuredUntil: until });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Validation impossible.' });
  }
});

app.post('/api/admin/feature-requests/:id/reject', requireAdmin, (req, res) => {
  const result = db.prepare(`UPDATE products SET feature_requested = 0 WHERE id = ?`).run(req.params.id);
  if (!result.changes) return res.status(404).json({ success: false, message: 'Produit introuvable.' });
  res.json({ success: true });
});

app.get('/api/featured-products', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, name, description, price, digital,
           download_url AS downloadUrl, seller,
           seller_whatsapp AS sellerWhatsApp,
           image_url AS imageUrl, stock,
           created_at AS createdAt,
           featured_until AS featuredUntil
    FROM products
    WHERE featured_until IS NOT NULL AND datetime(featured_until) > datetime('now')
    ORDER BY datetime(featured_until) DESC
  `).all();
  res.json({ success: true, products: rows });
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, message: `Image trop grande. Maximum ${MAX_IMAGE_MB} Mo.` });
  }
  if (err) {
    return res.status(400).json({ success: false, message: 'Format d’image non pris en charge. Utilise JPG, PNG ou WebP.' });
  }
  res.status(500).json({ success: false, message: 'Erreur serveur.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur Ma Boutique démarré sur le port ${PORT}`);
  console.log(`URL publique configurée : ${PUBLIC_BASE_URL}`);
});
