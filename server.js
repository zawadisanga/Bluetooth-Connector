// server.js - Bluetooth Connector System (Fixed for Heroku)
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
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Environment Variables with defaults
const PORT = process.env.PORT || 3000;
const MAX_DEVICES = parseInt(process.env.MAX_DEVICES) || 50;
const ADMIN_CODE = process.env.ADMIN_CODE || 'ADMIN123';
const IS_FREE_MODE = process.env.IS_FREE_MODE === 'true' || true;

// Store active rooms and devices
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
        io.to(device.socketId).emit(event, data);
      }
    });
  }
}

// Health check endpoint for Heroku
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API Routes
app.get('/api/rooms', (req, res) => {
  try {
    const activeRooms = Array.from(rooms.values()).map(room => ({
      roomId: room.roomId,
      deviceCount: room.devices.size,
      maxDevices: MAX_DEVICES,
      createdAt: room.createdAt,
      creator: room.deviceName
    }));
    res.json({ rooms: activeRooms, isFreeMode: IS_FREE_MODE });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats', (req, res) => {
  res.json({
    totalRooms: rooms.size,
    totalDevices: devices.size,
    maxDevicesPerRoom: MAX_DEVICES,
    uptime: process.uptime(),
    nodeVersion: process.version,
    platform: process.platform
  });
});

// Admin route for premium features
app.post('/api/admin/upgrade', (req, res) => {
  const { adminCode, roomId, newMaxDevices } = req.body;
  if (adminCode !== ADMIN_CODE) {
    return res.status(403).json({ error: 'Invalid admin code' });
  }
  
  const room = rooms.get(roomId);
  if (room) {
    process.env.MAX_DEVICES = newMaxDevices;
    res.json({ success: true, message: 'Room upgraded to premium' });
  } else {
    res.status(404).json({ error: 'Room not found' });
  }
});

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log(`New device connected: ${socket.id}`);

  // Create new room
  socket.on('create-room', ({ deviceName, roomName }) => {
    try {
      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const room = new BluetoothRoom(roomId, socket.id, deviceName);
      rooms.set(roomId, room);
      
      socket.join(roomId);
      devices.set(socket.id, { roomId, deviceName, isCreator: true });
      
      socket.emit('room-created', {
        roomId,
        roomCode: roomId,
        deviceId: socket.id,
        maxDevices: MAX_DEVICES
      });
      
      io.to(roomId).emit('room-update', {
        deviceCount: room.devices.size,
        devices: Array.from(room.devices.values())
      });
      
      console.log(`Room created: ${roomId} by ${deviceName}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Join existing room
  socket.on('join-room', ({ roomId, deviceName }) => {
    try {
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
        roomId,
        deviceId: socket.id,
        deviceCount: result.deviceCount
      });
      
      io.to(roomId).emit('device-joined', {
        deviceName,
        deviceCount: result.deviceCount,
        devices: Array.from(room.devices.values())
      });
      
      if (room.isPlaying && room.currentMedia) {
        socket.emit('sync-playback', {
          media: room.currentMedia,
          currentTime: room.syncTime
        });
      }
      
      console.log(`${deviceName} joined room: ${roomId}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Start playback sync
  socket.on('start-playback', ({ roomId, mediaUrl, mediaType }) => {
    try {
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
        
        console.log(`Playback started in room: ${roomId}`);
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Sync playback position
  socket.on('sync-position', ({ roomId, currentTime }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.syncTime = currentTime;
      room.broadcastToDevices('sync-time', { currentTime }, socket.id);
    }
  });

  // Pause playback
  socket.on('pause-playback', ({ roomId }) => {
    try {
      const room = rooms.get(roomId);
      const device = devices.get(socket.id);
      
      if (room && device && device.isCreator) {
        room.isPlaying = false;
        io.to(roomId).emit('playback-paused');
        console.log(`Playback paused in room: ${roomId}`);
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Volume control
  socket.on('adjust-volume', ({ roomId, volume }) => {
    const device = devices.get(socket.id);
    if (device && device.isCreator) {
      io.to(roomId).emit('volume-adjusted', { volume });
    }
  });

  // Disconnect handling
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
            console.log(`Room closed: ${device.roomId}`);
          } else if (room.devices.size === 0) {
            rooms.delete(device.roomId);
          }
        }
        devices.delete(socket.id);
      }
      console.log(`Device disconnected: ${socket.id}`);
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  });
});

// Serve frontend - Catch all route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Bluetooth Connector Server running on port ${PORT}`);
  console.log(`📍 Mode: ${IS_FREE_MODE ? 'Free' : 'Premium'}`);
  console.log(`📊 Max devices per room: ${MAX_DEVICES}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
