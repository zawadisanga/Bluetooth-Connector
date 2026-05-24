// server.js - Full PWA Support with Enhanced Features
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Environment Variables
const PORT = process.env.PORT || 3000;
const MAX_DEVICES = parseInt(process.env.MAX_DEVICES) || 50;
const IS_FREE_MODE = process.env.IS_FREE_MODE === 'true' || true;

// Security Headers for PWA
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Allow PWA to work offline
  res.setHeader('Service-Worker-Allowed', '/');
  next();
});

// Store rooms
const rooms = new Map();
const devices = new Map();

class BluetoothRoom {
  constructor(roomId, creator, deviceName) {
    this.roomId = roomId;
    this.creator = creator;
    this.devices = new Map();
    this.isPlaying = false;
    this.currentMedia = null;
    this.syncTime = 0;
    this.createdAt = new Date();
    this.deviceName = deviceName;
  }

  addDevice(deviceId, deviceName, socketId) {
    if (this.devices.size >= MAX_DEVICES) {
      return { success: false, message: 'Room is full' };
    }
    this.devices.set(deviceId, { deviceName, socketId, connectedAt: new Date() });
    return { success: true, deviceCount: this.devices.size };
  }

  removeDevice(deviceId) {
    return this.devices.delete(deviceId);
  }

  broadcastToDevices(event, data, excludeDevice = null) {
    this.devices.forEach((device, deviceId) => {
      if (deviceId !== excludeDevice) {
        const socket = io.sockets.sockets.get(device.socketId);
        if (socket) socket.emit(event, data);
      }
    });
  }
}

// API Routes
app.get('/api/rooms', (req, res) => {
  const activeRooms = Array.from(rooms.values()).map(room => ({
    roomId: room.roomId,
    deviceCount: room.devices.size,
    maxDevices: MAX_DEVICES,
    createdAt: room.createdAt
  }));
  res.json({ success: true, rooms: activeRooms, isFreeMode: IS_FREE_MODE });
});

app.get('/api/stats', (req, res) => {
  res.json({
    success: true,
    totalRooms: rooms.size,
    totalDevices: devices.size,
    maxDevicesPerRoom: MAX_DEVICES,
    uptime: process.uptime(),
    nodeVersion: process.version,
    platform: process.platform
  });
});

// Health check endpoint for Heroku
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    rooms: rooms.size,
    devices: devices.size
  });
});

// ========== PWA MANIFEST - Enhanced Version ==========
app.get('/manifest.json', (req, res) => {
  res.json({
    name: "Bluetooth Connector",
    short_name: "BT Connector",
    description: "Connect multiple devices, listen together globally! Sync audio/video across all devices.",
    start_url: "/",
    display: "standalone",
    theme_color: "#667eea",
    background_color: "#667eea",
    orientation: "portrait",
    scope: "/",
    lang: "en",
    dir: "ltr",
    categories: ["entertainment", "music", "social", "communication"],
    icons: [
      {
        src: "/icons/icon-72x72.png",
        sizes: "72x72",
        type: "image/png",
        purpose: "any maskable"
      },
      {
        src: "/icons/icon-96x96.png",
        sizes: "96x96",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-128x128.png",
        sizes: "128x128",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-144x144.png",
        sizes: "144x144",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-152x152.png",
        sizes: "152x152",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable"
      },
      {
        src: "/icons/icon-384x384.png",
        sizes: "384x384",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      }
    ],
    shortcuts: [
      {
        name: "Create Room",
        short_name: "Create",
        description: "Start a new listening room",
        url: "/?action=create",
        icons: [{ src: "/icons/icon-96x96.png", sizes: "96x96" }]
      },
      {
        name: "Join Room",
        short_name: "Join",
        description: "Join an existing room",
        url: "/?action=join",
        icons: [{ src: "/icons/icon-96x96.png", sizes: "96x96" }]
      }
    ],
    screenshots: [
      {
        src: "/screenshots/mobile.png",
        sizes: "1080x1920",
        type: "image/png",
        platform: "android"
      }
    ],
    related_applications: [],
    prefer_related_applications: false
  });
});

// ========== SERVICE WORKER - Enhanced with Offline Support ==========
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.send(`
    const CACHE_NAME = 'bt-connector-v1.1.0';
    const STATIC_CACHE = 'bt-connector-static-v1';
    const DYNAMIC_CACHE = 'bt-connector-dynamic-v1';
    
    // Files to cache on install
    const urlsToCache = [
      '/',
      '/index.html',
      '/manifest.json',
      '/socket.io/socket.io.js'
    ];
    
    // Install event - cache core files
    self.addEventListener('install', event => {
      console.log('Service Worker installing...');
      event.waitUntil(
        caches.open(STATIC_CACHE)
          .then(cache => {
            console.log('Caching static assets');
            return cache.addAll(urlsToCache);
          })
          .then(() => self.skipWaiting())
      );
    });
    
    // Activate event - clean up old caches
    self.addEventListener('activate', event => {
      console.log('Service Worker activating...');
      event.waitUntil(
        caches.keys().then(cacheNames => {
          return Promise.all(
            cacheNames.map(cacheName => {
              if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
                console.log('Deleting old cache:', cacheName);
                return caches.delete(cacheName);
              }
            })
          );
        })
      );
      return self.clients.claim();
    });
    
    // Fetch event - serve from cache, fallback to network
    self.addEventListener('fetch', event => {
      // Skip non-GET requests and socket.io
      if (event.request.method !== 'GET' || event.request.url.includes('/socket.io')) {
        return fetch(event.request);
      }
      
      event.respondWith(
        caches.match(event.request)
          .then(cachedResponse => {
            // Return cached response if available
            if (cachedResponse) {
              return cachedResponse;
            }
            
            // Otherwise fetch from network
            return fetch(event.request)
              .then(response => {
                // Check if valid response
                if (!response || response.status !== 200 || response.type !== 'basic') {
                  return response;
                }
                
                // Clone response for caching
                const responseToCache = response.clone();
                caches.open(DYNAMIC_CACHE)
                  .then(cache => {
                    cache.put(event.request, responseToCache);
                  });
                
                return response;
              })
              .catch(() => {
                // If offline and no cache, show offline page
                if (event.request.mode === 'navigate') {
                  return caches.match('/index.html');
                }
                return new Response('You are offline', {
                  status: 503,
                  statusText: 'Service Unavailable'
                });
              });
          })
      );
    });
    
    // Sync event for background sync (future feature)
    self.addEventListener('sync', event => {
      console.log('Background sync event:', event);
      if (event.tag === 'sync-rooms') {
        event.waitUntil(syncRooms());
      }
    });
    
    // Push notification event (future feature)
    self.addEventListener('push', event => {
      const options = {
        body: event.data.text(),
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        vibrate: [200, 100, 200],
        data: {
          dateOfArrival: Date.now(),
          primaryKey: 1
        }
      };
      event.waitUntil(
        self.registration.showNotification('Bluetooth Connector', options)
      );
    });
  `);
});

// ========== ROUTE FOR ICONS GENERATION (Fallback if files missing) ==========
app.get('/icons/:size.png', (req, res) => {
  const size = parseInt(req.params.size) || 192;
  const { createCanvas } = require('canvas');
  
  try {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    
    // White circle background
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(size/2, size/2, size * 0.35, 0, Math.PI * 2);
    ctx.fill();
    
    // Emoji
    ctx.fillStyle = '#667eea';
    ctx.font = `${size * 0.4}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎧', size/2, size/2);
    
    res.setHeader('Content-Type', 'image/png');
    res.send(canvas.toBuffer());
  } catch (error) {
    console.error('Icon generation error:', error);
    // Fallback: redirect to emoji icon
    res.redirect(`data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23667eea'/%3E%3Ctext x='50' y='67' font-size='50' text-anchor='middle' fill='white'%3E🎧%3C/text%3E%3C/svg%3E`);
  }
});

// ========== ROBOTS.TXT ==========
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`
User-agent: *
Allow: /
Sitemap: https://${req.headers.host}/sitemap.xml
  `);
});

// ========== SITEMAP.XML ==========
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://${req.headers.host}/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`);
});

// ========== OFFLINE PAGE ==========
app.get('/offline.html', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Offline - Bluetooth Connector</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          margin: 0;
          padding: 20px;
          color: white;
        }
        .container {
          text-align: center;
        }
        h1 { font-size: 3em; margin-bottom: 20px; }
        p { font-size: 1.2em; margin-bottom: 30px; opacity: 0.9; }
        button {
          background: white;
          color: #667eea;
          border: none;
          padding: 12px 30px;
          border-radius: 25px;
          font-size: 1em;
          font-weight: bold;
          cursor: pointer;
        }
        button:hover { transform: scale(1.05); }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📡 You're Offline</h1>
        <p>Please check your internet connection<br>and try again.</p>
        <button onclick="location.reload()">Retry Connection</button>
      </div>
    </body>
    </html>
  `);
});

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log(`✅ Device connected: ${socket.id}`);

  socket.on('create-room', ({ deviceName, roomName }) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const room = new BluetoothRoom(roomId, socket.id, deviceName);
    rooms.set(roomId, room);
    socket.join(roomId);
    devices.set(socket.id, { roomId, deviceName, isCreator: true });
    
    socket.emit('room-created', { roomId, maxDevices: MAX_DEVICES });
    io.to(roomId).emit('room-update', {
      deviceCount: room.devices.size,
      devices: Array.from(room.devices.values())
    });
    console.log(`📱 Room created: ${roomId} by ${deviceName}`);
  });

  socket.on('join-room', ({ roomId, deviceName }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const result = room.addDevice(socket.id, deviceName, socket.id);
    if (!result.success) {
      socket.emit('error', { message: result.message });
      return;
    }

    socket.join(roomId);
    devices.set(socket.id, { roomId, deviceName, isCreator: false });
    
    socket.emit('joined-room', { roomId, deviceCount: result.deviceCount });
    io.to(roomId).emit('device-joined', {
      deviceName,
      deviceCount: result.deviceCount,
      devices: Array.from(room.devices.values())
    });
    console.log(`👤 ${deviceName} joined room: ${roomId}`);
  });

  socket.on('start-playback', ({ roomId, mediaUrl, mediaType }) => {
    const room = rooms.get(roomId);
    const device = devices.get(socket.id);
    if (room && device && device.isCreator) {
      room.isPlaying = true;
      room.currentMedia = { url: mediaUrl, type: mediaType };
      io.to(roomId).emit('playback-started', { media: room.currentMedia });
      console.log(`▶️ Playback started in room: ${roomId}`);
    }
  });

  socket.on('pause-playback', ({ roomId }) => {
    const room = rooms.get(roomId);
    const device = devices.get(socket.id);
    if (room && device && device.isCreator) {
      room.isPlaying = false;
      io.to(roomId).emit('playback-paused');
      console.log(`⏸️ Playback paused in room: ${roomId}`);
    }
  });

  socket.on('sync-position', ({ roomId, currentTime }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.syncTime = currentTime;
      room.broadcastToDevices('sync-time', { currentTime }, socket.id);
    }
  });

  socket.on('adjust-volume', ({ roomId, volume }) => {
    const device = devices.get(socket.id);
    if (device && device.isCreator) {
      io.to(roomId).emit('volume-adjusted', { volume });
    }
  });

  socket.on('disconnect', () => {
    const device = devices.get(socket.id);
    if (device) {
      const room = rooms.get(device.roomId);
      if (room) {
        room.removeDevice(socket.id);
        io.to(device.roomId).emit('device-left', {
          deviceName: device.deviceName,
          deviceCount: room.devices.size
        });
        if (device.isCreator) {
          rooms.delete(device.roomId);
          console.log(`❌ Room closed: ${device.roomId}`);
        }
      }
      devices.delete(socket.id);
      console.log(`👋 Device disconnected: ${socket.id}`);
    }
  });
});

// Serve frontend - catch all route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║     🎧 Bluetooth Connector - PWA Ready Server          ║
╠══════════════════════════════════════════════════════════╣
║  ✅ Server running on port: ${PORT}                       ║
║  🌐 Local: http://localhost:${PORT}                       ║
║  📱 PWA Manifest: /manifest.json                         ║
║  ⚙️  Service Worker: /sw.js                               ║
║  💊 Health Check: /health                                ║
║  📊 Mode: ${IS_FREE_MODE ? 'FREE' : 'PREMIUM'}                          ║
║  👥 Max devices: ${MAX_DEVICES}                                      ║
╚══════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
