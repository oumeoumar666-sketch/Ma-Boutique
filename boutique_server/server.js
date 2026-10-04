const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const MAX_IMAGE_MB = Number(process.env.MAX_IMAGE_MB || 5);
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// Supabase - les deux variables sont à configurer dans Render.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'product-images';

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.warn('ATTENTION: SUPABASE_URL ou SUPABASE_SECRET_KEY est manquant.');
}

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ success: false, message: 'Accès administrateur refusé.' });
  }
  next();
}

function ensureSupabaseConfigured() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    const error = new Error('Configuration Supabase manquante.');
    error.status = 500;
    throw error;
  }
}

async function supabaseRequest(endpoint, options = {}) {
  ensureSupabaseConfigured();

  const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }

  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.hint || text || `Supabase HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.supabase = data;
    throw error;
  }

  return data;
}

function supabasePublicImageUrl(fileName) {
  return `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURIComponent(fileName)}`;
}

async function uploadImageToSupabase(file) {
  ensureSupabaseConfigured();

  const ext = path.extname(file.originalname || '').toLowerCase();
  const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`;
  const contentType = file.mimetype || 'image/jpeg';
  const buffer = fs.readFileSync(file.path);

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURIComponent(fileName)}`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
      body: buffer,
    }
  );

  const text = await response.text();
  if (!response.ok) {
    let data;
    try { data = JSON.parse(text); } catch (_) { data = null; }
    const error = new Error(data?.message || data?.error || text || `Upload image HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return {
    fileName,
    imageUrl: supabasePublicImageUrl(fileName),
  };
}

async function deleteImageFromSupabase(fileName) {
  if (!fileName) return;
  try {
    await supabaseRequest(`/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURIComponent(fileName)}`, {
      method: 'DELETE',
    });
  } catch (error) {
    console.error('Suppression image Supabase échouée:', error.message);
  }
}

function imageFileNameFromUrl(imageUrl) {
  if (!imageUrl) return null;
  const marker = `/storage/v1/object/public/${SUPABASE_BUCKET}/`;
  const index = imageUrl.indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(imageUrl.slice(index + marker.length));
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Multer utilise temporairement /tmp sur Render. L'image est ensuite envoyée à Supabase.
const tempUploadDir = path.join('/tmp', 'ma-boutique-uploads');
fs.mkdirSync(tempUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tempUploadDir),
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

app.get('/api/products', async (_req, res) => {
  try {
    const rows = await supabaseRequest(
      '/rest/v1/products?select=id,name,description,price,digital,download_url,seller,seller_whatsapp,image_url,stock,created_at,featured_until,feature_requested&order=created_at.desc'
    );

    const products = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description || '',
      price: Number(row.price),
      digital: Boolean(row.digital),
      downloadUrl: row.download_url || '',
      seller: row.seller,
      sellerWhatsApp: row.seller_whatsapp,
      imageUrl: row.image_url,
      stock: Number(row.stock ?? 0),
      createdAt: row.created_at,
      featuredUntil: row.featured_until,
      featureRequested: Number(row.feature_requested || 0),
    }));

    res.json({ success: true, products });
  } catch (error) {
    console.error('GET /api/products:', error);
    res.status(error.status || 500).json({ success: false, message: 'Impossible de récupérer les produits.' });
  }
});

app.post('/api/products', upload.single('image'), async (req, res) => {
  let uploadedFileName = null;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'La photo du produit est obligatoire.' });
    }

    const {
      name,
      description = '',
      price,
      digital = 'false',
      downloadUrl = '',
      seller,
      sellerWhatsApp,
      stock = '1',
    } = req.body;

    const numericPrice = Number(price);
    const numericStock = Math.max(0, Number.parseInt(stock, 10) || 0);
    const isDigital = digital === 'true' || digital === '1';

    if (!name || !seller || !sellerWhatsApp || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Informations du produit invalides.' });
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const createdAt = new Date().toISOString();

    const image = await uploadImageToSupabase(req.file);
    uploadedFileName = image.fileName;

    const product = {
      id,
      name: name.trim(),
      description: description.trim(),
      price: numericPrice,
      digital: isDigital,
      download_url: downloadUrl.trim(),
      seller: seller.trim(),
      seller_whatsapp: sellerWhatsApp.replace(/\D/g, ''),
      image_url: image.imageUrl,
      stock: numericStock,
      created_at: createdAt,
      featured_until: null,
      feature_requested: 0,
    };

    await supabaseRequest('/rest/v1/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(product),
    });

    fs.unlinkSync(req.file.path);
    uploadedFileName = null;

    res.status(201).json({
      success: true,
      product: {
        id,
        name: product.name,
        description: product.description,
        price: numericPrice,
        digital: isDigital,
        downloadUrl: product.download_url,
        seller: product.seller,
        sellerWhatsApp: product.seller_whatsapp,
        imageUrl: product.image_url,
        stock: numericStock,
        createdAt,
        featuredUntil: null,
        featureRequested: 0,
      },
    });
  } catch (error) {
    console.error('POST /api/products:', error);

    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    if (uploadedFileName) await deleteImageFromSupabase(uploadedFileName);

    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Erreur serveur lors de la publication.',
    });
  }
});

app.post('/api/products/:id/feature-request', async (req, res) => {
  try {
    const { seller } = req.body;
    if (!seller) return res.status(400).json({ success: false, message: 'Vendeur manquant.' });

    const rows = await supabaseRequest(
      `/rest/v1/products?id=eq.${encodeURIComponent(req.params.id)}&seller=eq.${encodeURIComponent(seller.trim())}&select=id`
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Produit introuvable.' });

    await supabaseRequest(`/rest/v1/products?id=eq.${encodeURIComponent(req.params.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ feature_requested: 1 }),
    });

    res.json({ success: true, pending: true, message: 'Demande de mise en avant enregistrée.' });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: 'Erreur lors de la demande.' });
  }
});

app.get('/api/admin/feature-requests', requireAdmin, async (_req, res) => {
  try {
    const rows = await supabaseRequest(
      '/rest/v1/products?select=id,name,seller,price,image_url,feature_requested,featured_until&feature_requested=eq.1&order=created_at.desc'
    );
    res.json({
      success: true,
      requests: rows.map((row) => ({
        id: row.id,
        name: row.name,
        seller: row.seller,
        price: Number(row.price),
        imageUrl: row.image_url,
        featureRequested: Number(row.feature_requested || 0),
        featuredUntil: row.featured_until,
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: 'Impossible de récupérer les demandes.' });
  }
});

app.post('/api/admin/feature-requests/:id/approve', requireAdmin, async (req, res) => {
  try {
    const days = Number.parseInt(req.body.days, 10);
    if (![3, 7, 30].includes(days)) {
      return res.status(400).json({ success: false, message: 'Durée invalide.' });
    }

    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const existing = await supabaseRequest(
      `/rest/v1/products?id=eq.${encodeURIComponent(req.params.id)}&select=id`
    );
    if (!existing.length) return res.status(404).json({ success: false, message: 'Produit introuvable.' });

    await supabaseRequest(`/rest/v1/products?id=eq.${encodeURIComponent(req.params.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ feature_requested: 0, featured_until: until }),
    });

    res.json({ success: true, featuredUntil: until });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: 'Validation impossible.' });
  }
});

app.post('/api/admin/feature-requests/:id/reject', requireAdmin, async (req, res) => {
  try {
    const existing = await supabaseRequest(
      `/rest/v1/products?id=eq.${encodeURIComponent(req.params.id)}&select=id`
    );
    if (!existing.length) return res.status(404).json({ success: false, message: 'Produit introuvable.' });

    await supabaseRequest(`/rest/v1/products?id=eq.${encodeURIComponent(req.params.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ feature_requested: 0 }),
    });

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: 'Erreur lors du refus.' });
  }
});

app.get('/api/featured-products', async (_req, res) => {
  try {
    const now = new Date().toISOString();
    const rows = await supabaseRequest(
      `/rest/v1/products?select=id,name,description,price,digital,download_url,seller,seller_whatsapp,image_url,stock,created_at,featured_until&featured_until=not.is.null&featured_until=gt.${encodeURIComponent(now)}&order=featured_until.desc`
    );

    res.json({
      success: true,
      products: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description || '',
        price: Number(row.price),
        digital: Boolean(row.digital),
        downloadUrl: row.download_url || '',
        seller: row.seller,
        sellerWhatsApp: row.seller_whatsapp,
        imageUrl: row.image_url,
        stock: Number(row.stock ?? 0),
        createdAt: row.created_at,
        featuredUntil: row.featured_until,
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: 'Impossible de récupérer les produits mis en avant.' });
  }
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
  console.log(`Supabase configuré : ${Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY)}`);
  console.log(`Bucket images : ${SUPABASE_BUCKET}`);
});
