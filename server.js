// server.js - Full PWA Support
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Environment Variables
const PORT = process.env.PORT || 3000;
const MAX_DEVICES = parseInt(process.env.MAX_DEVICES) || 50;
const IS_FREE_MODE = process.env.IS_FREE_MODE === 'true' || true;

// PWA Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
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

// PWA Manifest
app.get('/manifest.json', (req, res) => {
  res.json({
    name: "Bluetooth Connector",
    short_name: "BT Connector",
    description: "Connect multiple devices, listen together globally!",
    start_url: "/",
    display: "standalone",
    theme_color: "#667eea",
    background_color: "#667eea",
    orientation: "portrait",
    scope: "/",
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
        type: "image/png"
      },
      {
        src: "/icons/icon-128x128.png",
        sizes: "128x128",
        type: "image/png"
      },
      {
        src: "/icons/icon-144x144.png",
        sizes: "144x144",
        type: "image/png"
      },
      {
        src: "/icons/icon-152x152.png",
        sizes: "152x152",
        type: "image/png"
      },
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/icons/icon-384x384.png",
        sizes: "384x384",
        type: "image/png"
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png"
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
        description: "Join existing room",
        url: "/?action=join",
        icons: [{ src: "/icons/icon-96x96.png", sizes: "96x96" }]
      }
    ],
    categories: ["entertainment", "music", "social"],
    screenshots: [
      {
        src: "/screenshots/desktop.png",
        sizes: "1280x720",
        type: "image/png",
        platform: "wide"
      }
    ]
  });
});

// Service Worker
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.send(`
    const CACHE_NAME = 'bt-connector-v1.0.0';
    const urlsToCache = [
      '/',
      '/index.html',
      '/manifest.json',
      'https://cdn.socket.io/4.5.4/socket.io.min.js'
    ];

    self.addEventListener('install', event => {
      event.waitUntil(
        caches.open(CACHE_NAME)
          .then(cache => cache.addAll(urlsToCache))
      );
    });

    self.addEventListener('fetch', event => {
      event.respondWith(
        caches.match(event.request)
          .then(response => response || fetch(event.request))
      );
    });

    self.addEventListener('activate', event => {
      event.waitUntil(
        caches.keys().then(cacheNames => {
          return Promise.all(
            cacheNames.map(cacheName => {
              if (cacheName !== CACHE_NAME) {
                return caches.delete(cacheName);
              }
            })
          );
        })
      );
    });
  `);
});

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log(`Device connected: ${socket.id}`);

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
  });

  socket.on('start-playback', ({ roomId, mediaUrl, mediaType }) => {
    const room = rooms.get(roomId);
    const device = devices.get(socket.id);
    if (room && device && device.isCreator) {
      room.isPlaying = true;
      room.currentMedia = { url: mediaUrl, type: mediaType };
      io.to(roomId).emit('playback-started', { media: room.currentMedia });
    }
  });

  socket.on('pause-playback', ({ roomId }) => {
    const room = rooms.get(roomId);
    const device = devices.get(socket.id);
    if (room && device && device.isCreator) {
      room.isPlaying = false;
      io.to(roomId).emit('playback-paused');
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
        }
      }
      devices.delete(socket.id);
    }
  });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
});
