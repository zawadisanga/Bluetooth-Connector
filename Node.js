// server.js - Bluetooth Connector System
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
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Environment Variables
const PORT = process.env.PORT || 3000;
const MAX_DEVICES = process.env.MAX_DEVICES || 50;
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

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log(`New device connected: ${socket.id}`);

  // Create new room (Bluetooth Connector)
  socket.on('create-room', ({ deviceName, roomName }) => {
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
  });

  // Join existing room
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
    
    socket.emit('joined-room', {
      roomId,
      deviceId: socket.id,
      deviceCount: result.deviceCount
    });
    
    // Notify all devices in room
    io.to(roomId).emit('device-joined', {
      deviceName,
      deviceCount: result.deviceCount,
      devices: Array.from(room.devices.values())
    });
    
    // Sync current media if playing
    if (room.isPlaying && room.currentMedia) {
      socket.emit('sync-playback', {
        media: room.currentMedia,
        currentTime: room.syncTime
      });
    }
  });

  // Start playback sync
  socket.on('start-playback', ({ roomId, mediaUrl, mediaType }) => {
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
    const room = rooms.get(roomId);
    const device = devices.get(socket.id);
    
    if (room && device && device.isCreator) {
      room.isPlaying = false;
      io.to(roomId).emit('playback-paused');
    }
  });

  // Volume control (creator controls all)
  socket.on('adjust-volume', ({ roomId, volume }) => {
    const device = devices.get(socket.id);
    if (device && device.isCreator) {
      io.to(roomId).emit('volume-adjusted', { volume });
    }
  });

  // Disconnect handling
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
        
        // If creator leaves, delete room
        if (device.isCreator) {
          rooms.delete(device.roomId);
          io.to(device.roomId).emit('room-closed', { message: 'Host disconnected' });
        } else if (room.devices.size === 0) {
          rooms.delete(device.roomId);
        }
      }
      devices.delete(socket.id);
    }
  });
});

// API Routes
app.get('/api/rooms', (req, res) => {
  const activeRooms = Array.from(rooms.values()).map(room => ({
    roomId: room.roomId,
    deviceCount: room.devices.size,
    maxDevices: MAX_DEVICES,
    createdAt: room.createdAt,
    creator: room.deviceName
  }));
  res.json({ rooms: activeRooms, isFreeMode: IS_FREE_MODE });
});

app.get('/api/stats', (req, res) => {
  res.json({
    totalRooms: rooms.size,
    totalDevices: devices.size,
    maxDevicesPerRoom: MAX_DEVICES,
    uptime: process.uptime()
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
    // Premium feature: increase device limit
    process.env.MAX_DEVICES = newMaxDevices;
    res.json({ success: true, message: 'Room upgraded to premium' });
  } else {
    res.status(404).json({ error: 'Room not found' });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Bluetooth Connector Server running on port ${PORT}`);
  console.log(`Mode: ${IS_FREE_MODE ? 'Free' : 'Premium'}`);
  console.log(`Max devices per room: ${MAX_DEVICES}`);
});
