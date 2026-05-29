// ============================================================
// CrazyXYZ Backend Server
// Node.js + Express + MongoDB + Cloudinary
// ============================================================

const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const multer     = require('multer');
const cloudinary = require('cloudinary').v2;
const path       = require('path');

const app = express();

// ============================================================
// CONFIG — Replace with your values if changed
// ============================================================
const CONFIG = {
  PORT:       process.env.PORT || 3000,
  MONGO_URI:  process.env.MONGO_URI  || 'mongodb+srv://ranusingh983751_db_user:vanshika143kanishk@cluster0.ysiijmj.mongodb.net/crazyxyz?appName=Cluster0',
  CLOUD_NAME: process.env.CLOUD_NAME || 'dyvzsg1xu',
  API_KEY:    process.env.API_KEY    || '181281869156196',
  API_SECRET: process.env.API_SECRET || 'Hp6c5v1xNkrmX-ARQvIuuckBZOU',

  // Admin phone numbers — sirf ye log upload/delete kar sakte hain
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
// MONGODB CONNECTION
// ============================================================
mongoose.connect(CONFIG.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

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
  status:       { type: String, default: 'ready' },  // ready | processing | error
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

// Multer — memory storage (file Cloudinary pe jaayegi)
const storage = multer.memoryStorage();
const upload  = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Sirf video files allowed hain (mp4, mov, avi, webm)'));
  }
});

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
// PUBLIC API ENDPOINTS
// ============================================================

// GET /getShortVideos — Paginated videos
app.get('/getShortVideos', async (req, res) => {
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
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /addView — View count track karo
app.post('/addView', async (req, res) => {
  try {
    const { videoId } = req.body;
    if (!videoId) return res.json({ success: false });

    await Video.findByIdAndUpdate(videoId, {
      $inc: { viewCount: 1 },
      $set: { views: '' } // updated below
    });

    const video = await Video.findById(videoId);
    if (video) {
      const count = video.viewCount;
      const formatted = count >= 1000000 ? (count/1000000).toFixed(1) + 'M'
                      : count >= 1000    ? (count/1000).toFixed(1) + 'K'
                      : String(count);
      await Video.findByIdAndUpdate(videoId, { views: formatted });
    }

    // Analytics update
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

// POST /watchTime — Watch time track karo
app.post('/watchTime', async (req, res) => {
  try {
    const { videoId, totalSeconds, percentWatched } = req.body;
    if (!videoId) return res.json({ success: false });

    await Analytics.findOneAndUpdate(
      { videoId },
      {
        $inc: { totalWatchTime: totalSeconds || 0 },
        $push: { sessions: { elapsed: totalSeconds, percent: percentWatched, ts: new Date() } },
        $set: { updatedAt: new Date() }
      },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /addImpression — Ad impression track karo
app.post('/addImpression', async (req, res) => {
  try {
    const { adId } = req.body;
    if (!adId) return res.json({ success: false });
    // Store in general analytics (adId as videoId)
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
// ADMIN API ENDPOINTS (phone check required)
// ============================================================

// POST /admin/upload — Video upload karo
app.post('/admin/upload', isAdmin, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Video file required' });

    const { title, category, emoji, gradient } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Title required' });

    // Status: processing
    const newVideo = new Video({
      title,
      category:   category  || 'Other',
      emoji:      emoji     || '🎬',
      gradient:   gradient  || 'linear-gradient(135deg,#1a0505,#3a0a0a)',
      status:     'processing',
      published:  false,
      uploadedBy: req.adminPhone
    });
    await newVideo.save();

    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'video',
          folder:        'crazyxyz/videos',
          public_id:     'video_' + newVideo._id,
          eager: [
            { streaming_profile: 'hd', format: 'm3u8' }
          ],
          eager_async:        true,
          transformation: [
            { quality: 'auto', fetch_format: 'mp4' }
          ]
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    // Thumbnail generate
    const thumbUrl = cloudinary.url(uploadResult.public_id, {
      resource_type: 'video',
      format:        'jpg',
      transformation: [{ width: 400, height: 720, crop: 'fill' }, { quality: 'auto' }]
    });

    // Duration
    const duration = Math.round(uploadResult.duration || 30);

    // Update video record
    await Video.findByIdAndUpdate(newVideo._id, {
      videoUrl:     uploadResult.secure_url,
      thumbnailUrl: thumbUrl,
      publicId:     uploadResult.public_id,
      duration,
      status:       'ready',
      published:    true,
      updatedAt:    new Date()
    });

    const updatedVideo = await Video.findById(newVideo._id);
    res.json({ success: true, video: updatedVideo });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /admin/videos — Saari videos (admin ke liye)
app.get('/admin/videos', isAdmin, async (req, res) => {
  try {
    const videos = await Video.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, videos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /admin/video/:id — Video delete karo
app.delete('/admin/video/:id', isAdmin, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });

    // Cloudinary se delete karo
    if (video.publicId) {
      await cloudinary.uploader.destroy(video.publicId, { resource_type: 'video' });
    }

    await Video.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Video deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /admin/video/:id — Video update karo (title, published, category)
app.put('/admin/video/:id', isAdmin, async (req, res) => {
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

// GET /admin/analytics — Full analytics
app.get('/admin/analytics', isAdmin, async (req, res) => {
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

// GET /health — Server status check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status:  'CrazyXYZ Backend Running ✅',
    time:    new Date().toISOString()
  });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(CONFIG.PORT, () => {
  console.log(`\n🚀 CrazyXYZ Backend running on port ${CONFIG.PORT}`);
  console.log(`📡 Health check: http://localhost:${CONFIG.PORT}/health`);
  console.log(`👑 Admin phones: ${CONFIG.ADMIN_PHONES.join(', ')}\n`);
});
