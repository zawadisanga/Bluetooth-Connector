// server.js - Full PWA Support with custom logo
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

// Serve static files from root (manifest, sw.js, sitemap.xml)
app.use(express.static(__dirname));

// Serve static files from public folder (images, html files)
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
    uptime: process.uptime()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    rooms: rooms.size,
    devices: devices.size
  });
});

// PWA Manifest
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

// Service Worker
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

// Robots.txt
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`
User-agent: *
Allow: /
Sitemap: https://${req.headers.host}/sitemap.xml
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
║  🌐 URL: http://localhost:${PORT}                         ║
║  📱 PWA Manifest: /manifest.json                         ║
║  ⚙️  Service Worker: /sw.js                               ║
║  🖼️  Custom Logo: /zas.png                                ║
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
