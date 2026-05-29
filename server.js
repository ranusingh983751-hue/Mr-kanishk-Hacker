// ============================================================
// CrazyXYZ Backend Server
// Node.js + Express + MongoDB + Cloudinary
// FIXED: MongoDB timeout, bufferCommands, keep-alive
// ============================================================

const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const multer     = require('multer');
const cloudinary = require('cloudinary').v2;

const app = express();

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  PORT:       process.env.PORT || 3000,
  MONGO_URI:  process.env.MONGO_URI  || 'mongodb+srv://ranusingh983751_db_user:vanshika143kanishk@cluster0.ysiijmj.mongodb.net/crazyxyz?appName=Cluster0',
  CLOUD_NAME: process.env.CLOUD_NAME || 'dyvzsg1xu',
  API_KEY:    process.env.API_KEY    || '181281869156196',
  API_SECRET: process.env.API_SECRET || 'Hp6c5v1xNkrmV-ARQvIuuckBZOU',
  ADMIN_PHONES: ['8279474363', '8057123041', '9837514185']
};

// ============================================================
// CLOUDINARY SETUP
// ============================================================
cloudinary.config({
  cloud_name: CONFIG.CLOUD_NAME,
  api_key:    CONFIG.API_KEY,
  api_secret: CONFIG.API_SECRET
});

// ============================================================
// MONGODB CONNECTION — FIXED ✅
// ============================================================
mongoose.set('bufferCommands', false); // FIX 1: buffering band karo — seedha error aayega instead of hanging

const MONGO_OPTIONS = {
  serverSelectionTimeoutMS: 10000,  // FIX 2: 10s mein server select nahi hua toh fail fast
  socketTimeoutMS:          60000,  // FIX 3: 60s socket timeout (bade uploads ke liye)
  connectTimeoutMS:         15000,  // FIX 4: initial connect timeout
  maxPoolSize:              10,     // connection pool
  minPoolSize:              2,      // hamesha 2 connection ready
  heartbeatFrequencyMS:     10000,  // FIX 5: har 10s pe heartbeat — Atlas idle disconnect se bachao
  retryWrites:              true,
  w:                        'majority'
};

async function connectDB() {
  try {
    await mongoose.connect(CONFIG.MONGO_URI, MONGO_OPTIONS);
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB initial connect failed:', err.message);
    // FIX 6: Retry — 5s baad dobara try karo
    console.log('🔄 Retrying in 5 seconds...');
    setTimeout(connectDB, 5000);
  }
}

// Connection event listeners
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected — reconnecting...');
  setTimeout(connectDB, 3000); // auto-reconnect
});
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB error:', err.message);
});
mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

connectDB();

// ============================================================
// MONGODB SCHEMAS
// ============================================================
const VideoSchema = new mongoose.Schema({
  title:        { type: String, required: true },
  videoUrl:     { type: String, default: '' },
  hlsUrl:       { type: String, default: '' },
  thumbnailUrl: { type: String, default: '' },
  publicId:     { type: String, default: '' },
  emoji:        { type: String, default: '🎬' },
  gradient:     { type: String, default: 'linear-gradient(135deg,#1a0505,#3a0a0a)' },
  views:        { type: String, default: '0' },
  viewCount:    { type: Number, default: 0 },
  likes:        { type: Number, default: 0 },
  category:     { type: String, default: 'Other' },
  duration:     { type: Number, default: 30 },
  status:       { type: String, default: 'ready' },
  published:    { type: Boolean, default: true },
  uploadedBy:   { type: String, default: '' },
  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now }
});

const AnalyticsSchema = new mongoose.Schema({
  videoId:        { type: String, required: true, unique: true },
  totalViews:     { type: Number, default: 0 },
  totalWatchTime: { type: Number, default: 0 },
  adImpressions:  { type: Number, default: 0 },
  sessions:       { type: Array,  default: [] },
  updatedAt:      { type: Date,   default: Date.now }
});

const Video     = mongoose.model('Video',     VideoSchema);
const Analytics = mongoose.model('Analytics', AnalyticsSchema);

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer — memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Sirf video files allowed hain (mp4, mov, avi, webm)'));
  }
});

// ============================================================
// DB CONNECTION CHECK MIDDLEWARE — FIX 7
// ============================================================
function requireDB(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      message: 'Database connect nahi hai, thodi der mein try karo'
    });
  }
  next();
}

// ============================================================
// ADMIN CHECK MIDDLEWARE
// ============================================================
function isAdmin(req, res, next) {
  const phone = req.headers['x-admin-phone'] || req.body.adminPhone || req.query.adminPhone;
  const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
  const isAdminUser = CONFIG.ADMIN_PHONES.some(p => p.replace(/\D/g, '') === cleanPhone);
  if (!isAdminUser) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  req.adminPhone = cleanPhone;
  next();
}

// ============================================================
// KEEP-ALIVE — FIX 8: Render free tier sleep se bachao
// ============================================================
setInterval(() => {
  mongoose.connection.db?.admin().ping().catch(() => {});
  console.log('💓 Keep-alive ping —', new Date().toISOString());
}, 4 * 60 * 1000); // har 4 minute pe ping

// ============================================================
// PUBLIC API ENDPOINTS
// ============================================================

// GET /health
app.get('/health', (req, res) => {
  const dbState = ['disconnected','connected','connecting','disconnecting'];
  res.json({
    success: true,
    status:  'CrazyXYZ Backend Running ✅',
    db:      dbState[mongoose.connection.readyState] || 'unknown',
    time:    new Date().toISOString()
  });
});

// GET /getShortVideos
app.get('/getShortVideos', requireDB, async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 0;
    const limit = parseInt(req.query.limit) || 5;
    const skip  = page * limit;

    const [videos, total] = await Promise.all([
      Video.find({ published: true, status: 'ready' })
           .sort({ createdAt: -1 })
           .skip(skip)
           .limit(limit)
           .lean(),
      Video.countDocuments({ published: true, status: 'ready' })
    ]);

    res.json({ success: true, videos, totalCount: total, page, limit });
  } catch (err) {
    console.error('getShortVideos error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /addView
app.post('/addView', requireDB, async (req, res) => {
  try {
    const { videoId } = req.body;
    if (!videoId) return res.json({ success: false });

    const video = await Video.findByIdAndUpdate(
      videoId,
      { $inc: { viewCount: 1 } },
      { new: true }
    );

    if (video) {
      const count = video.viewCount;
      const formatted = count >= 1000000 ? (count/1000000).toFixed(1) + 'M'
                      : count >= 1000    ? (count/1000).toFixed(1) + 'K'
                      : String(count);
      await Video.findByIdAndUpdate(videoId, { views: formatted });
    }

    await Analytics.findOneAndUpdate(
      { videoId },
      { $inc: { totalViews: 1 }, $set: { updatedAt: new Date() } },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /watchTime
app.post('/watchTime', requireDB, async (req, res) => {
  try {
    const { videoId, totalSeconds, percentWatched } = req.body;
    if (!videoId) return res.json({ success: false });

    await Analytics.findOneAndUpdate(
      { videoId },
      {
        $inc: { totalWatchTime: totalSeconds || 0 },
        $push: { sessions: { elapsed: totalSeconds, percent: percentWatched, ts: new Date() } },
        $set:  { updatedAt: new Date() }
      },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /addImpression
app.post('/addImpression', requireDB, async (req, res) => {
  try {
    const { adId } = req.body;
    if (!adId) return res.json({ success: false });
    await Analytics.findOneAndUpdate(
      { videoId: 'ad_' + adId },
      { $inc: { adImpressions: 1 }, $set: { updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ADMIN API ENDPOINTS
// ============================================================

// POST /admin/upload — FIX 9: timeout badhaya, proper error handling
app.post('/admin/upload', isAdmin, requireDB, upload.single('video'), async (req, res) => {
  // Multer error handle karo
  if (req.fileValidationError) {
    return res.status(400).json({ success: false, message: req.fileValidationError });
  }

  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Video file required' });

    const { title, category, emoji, gradient } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Title required' });

    // Pehle DB mein save karo (status: processing)
    const newVideo = await Video.create({
      title,
      category:   category || 'Other',
      emoji:      emoji    || '🎬',
      gradient:   gradient || 'linear-gradient(135deg,#1a0505,#3a0a0a)',
      status:     'processing',
      published:  false,
      uploadedBy: req.adminPhone
    });

    console.log(`📤 Uploading video "${title}" to Cloudinary...`);

    // Cloudinary upload — timeout 10 minutes
    const uploadResult = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Cloudinary upload timeout (10min)')), 10 * 60 * 1000);

      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type:  'video',
          folder:         'crazyxyz/videos',
          public_id:      'video_' + newVideo._id,
          eager: [
            { streaming_profile: 'hd', format: 'm3u8' }
          ],
          eager_async:    true,
          transformation: [{ quality: 'auto', fetch_format: 'mp4' }]
        },
        (error, result) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    // Thumbnail URL
    const thumbUrl = cloudinary.url(uploadResult.public_id, {
      resource_type:  'video',
      format:         'jpg',
      transformation: [{ width: 400, height: 720, crop: 'fill' }, { quality: 'auto' }]
    });

    const duration = Math.round(uploadResult.duration || 30);

    // DB update: ready + published
    const updatedVideo = await Video.findByIdAndUpdate(
      newVideo._id,
      {
        videoUrl:     uploadResult.secure_url,
        thumbnailUrl: thumbUrl,
        publicId:     uploadResult.public_id,
        duration,
        status:       'ready',
        published:    true,
        updatedAt:    new Date()
      },
      { new: true }
    );

    console.log(`✅ Video "${title}" uploaded successfully`);
    res.json({ success: true, video: updatedVideo });

  } catch (err) {
    console.error('❌ Upload error:', err.message);
    // Agar DB mein processing record hai toh status error karo
    if (req.body && req.body.title) {
      try {
        await Video.findOneAndUpdate(
          { title: req.body.title, status: 'processing' },
          { status: 'error', updatedAt: new Date() }
        );
      } catch(e) {}
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /admin/videos
app.get('/admin/videos', isAdmin, requireDB, async (req, res) => {
  try {
    const videos = await Video.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, videos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /admin/video/:id
app.delete('/admin/video/:id', isAdmin, requireDB, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });

    if (video.publicId) {
      await cloudinary.uploader.destroy(video.publicId, { resource_type: 'video' }).catch(e => {
        console.warn('Cloudinary delete warning:', e.message);
      });
    }

    await Video.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Video deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /admin/video/:id
app.put('/admin/video/:id', isAdmin, requireDB, async (req, res) => {
  try {
    const { title, published, category, emoji } = req.body;
    const update = { updatedAt: new Date() };
    if (title     !== undefined) update.title     = title;
    if (published !== undefined) update.published = published;
    if (category  !== undefined) update.category  = category;
    if (emoji     !== undefined) update.emoji     = emoji;

    const video = await Video.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ success: true, video });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /admin/analytics
app.get('/admin/analytics', isAdmin, requireDB, async (req, res) => {
  try {
    const [analytics, videos] = await Promise.all([
      Analytics.find().lean(),
      Video.find().select('title emoji category viewCount').lean()
    ]);
    res.json({ success: true, analytics, videos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// START SERVER
// ============================================================
app.listen(CONFIG.PORT, () => {
  console.log(`\n🚀 CrazyXYZ Backend running on port ${CONFIG.PORT}`);
  console.log(`📡 Health: http://localhost:${CONFIG.PORT}/health`);
  console.log(`👑 Admin phones: ${CONFIG.ADMIN_PHONES.join(', ')}\n`);
});
