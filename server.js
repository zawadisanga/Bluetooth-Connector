// server.js - Bluetooth Connector (FULLY FIXED)
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files - IMPORTANT: Create public folder
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Environment Variables
const PORT = process.env.PORT || 3000;
const MAX_DEVICES = parseInt(process.env.MAX_DEVICES) || 50;
const IS_FREE_MODE = process.env.IS_FREE_MODE === 'true' || true;

// Store data
const rooms = new Map();
const devices = new Map();

console.log('🚀 Server starting...');
console.log('📁 Public path:', publicPath);
console.log('⚙️ Max devices:', MAX_DEVICES);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    rooms: rooms.size,
    devices: devices.size
  });
});

// API Routes - Without error throwing
app.get('/api/rooms', (req, res) => {
  try {
    const activeRooms = Array.from(rooms.values()).map(room => ({
      roomId: room.roomId,
      deviceCount: room.devices.size,
      maxDevices: MAX_DEVICES,
      createdAt: room.createdAt,
      creator: room.deviceName
    }));
    res.json({ success: true, rooms: activeRooms, isFreeMode: IS_FREE_MODE });
  } catch (error) {
    console.error('API Error:', error);
    res.json({ success: false, rooms: [], isFreeMode: IS_FREE_MODE });
  }
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

// Simple test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!', timestamp: Date.now() });
});

// Bluetooth Room Class
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
        if (socket) {
          socket.emit(event, data);
        }
      }
    });
  }
}

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log(`✅ Device connected: ${socket.id}`);

  // Create room
  socket.on('create-room', (data) => {
    try {
      console.log('Create room request:', data);
      const deviceName = data.deviceName || 'Anonymous';
      const roomName = data.roomName || 'My Room';
      
      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const room = new BluetoothRoom(roomId, socket.id, deviceName);
      rooms.set(roomId, room);
      
      socket.join(roomId);
      devices.set(socket.id, { roomId, deviceName, isCreator: true });
      
      socket.emit('room-created', {
        success: true,
        roomId: roomId,
        roomCode: roomId,
        deviceId: socket.id,
        maxDevices: MAX_DEVICES
      });
      
      io.to(roomId).emit('room-update', {
        deviceCount: room.devices.size,
        devices: Array.from(room.devices.values())
      });
      
      console.log(`✅ Room created: ${roomId} by ${deviceName}`);
    } catch (error) {
      console.error('Create room error:', error);
      socket.emit('error', { message: 'Failed to create room: ' + error.message });
    }
  });

  // Join room
  socket.on('join-room', (data) => {
    try {
      console.log('Join room request:', data);
      const roomId = data.roomId?.toUpperCase();
      const deviceName = data.deviceName || 'Guest';
      
      if (!roomId) {
        socket.emit('error', { message: 'Room ID is required' });
        return;
      }
      
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
      
      socket.emit('joined-room', {
        success: true,
        roomId: roomId,
        deviceId: socket.id,
        deviceCount: result.deviceCount
      });
      
      io.to(roomId).emit('device-joined', {
        deviceName: deviceName,
        deviceCount: result.deviceCount,
        devices: Array.from(room.devices.values())
      });
      
      // Sync if playing
      if (room.isPlaying && room.currentMedia) {
        socket.emit('sync-playback', {
          media: room.currentMedia,
          currentTime: room.syncTime
        });
      }
      
      console.log(`✅ ${deviceName} joined room: ${roomId}`);
    } catch (error) {
      console.error('Join room error:', error);
      socket.emit('error', { message: 'Failed to join room: ' + error.message });
    }
  });

  // Start playback
  socket.on('start-playback', (data) => {
    try {
      const { roomId, mediaUrl, mediaType } = data;
      const room = rooms.get(roomId);
      const device = devices.get(socket.id);
      
      if (room && device && device.isCreator) {
        room.isPlaying = true;
        room.currentMedia = { url: mediaUrl, type: mediaType };
        room.syncTime = 0;
        
        io.to(roomId).emit('playback-started', {
          media: room.currentMedia,
          startTime: Date.now()
        });
        
        console.log(`▶️ Playback started in room: ${roomId}`);
      }
    } catch (error) {
      console.error('Start playback error:', error);
      socket.emit('error', { message: 'Failed to start playback' });
    }
  });

  // Sync position
  socket.on('sync-position', (data) => {
    const { roomId, currentTime } = data;
    const room = rooms.get(roomId);
    if (room) {
      room.syncTime = currentTime;
      room.broadcastToDevices('sync-time', { currentTime }, socket.id);
    }
  });

  // Pause playback
  socket.on('pause-playback', (data) => {
    try {
      const { roomId } = data;
      const room = rooms.get(roomId);
      const device = devices.get(socket.id);
      
      if (room && device && device.isCreator) {
        room.isPlaying = false;
        io.to(roomId).emit('playback-paused');
        console.log(`⏸️ Playback paused in room: ${roomId}`);
      }
    } catch (error) {
      console.error('Pause playback error:', error);
    }
  });

  // Adjust volume
  socket.on('adjust-volume', (data) => {
    const { roomId, volume } = data;
    const device = devices.get(socket.id);
    if (device && device.isCreator) {
      io.to(roomId).emit('volume-adjusted', { volume });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    try {
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
            io.to(device.roomId).emit('room-closed', { message: 'Host disconnected' });
            console.log(`❌ Room closed: ${device.roomId}`);
          }
        }
        devices.delete(socket.id);
      }
      console.log(`❌ Device disconnected: ${socket.id}`);
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  });
});

// Catch-all route for SPA - MUST be last
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'), (err) => {
    if (err) {
      console.error('Error sending index.html:', err);
      res.status(404).send('Frontend file not found. Please ensure public/index.html exists.');
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ =====================================`);
  console.log(`🎧 Bluetooth Connector Server Running!`);
  console.log(`=====================================`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 URL: http://localhost:${PORT}`);
  console.log(`💊 Health: http://localhost:${PORT}/health`);
  console.log(`📊 Mode: ${IS_FREE_MODE ? 'FREE' : 'PREMIUM'}`);
  console.log(`👥 Max devices: ${MAX_DEVICES}`);
  console.log(`=====================================\n`);
});
