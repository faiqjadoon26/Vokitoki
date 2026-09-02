const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

// Serve static files from the 'public' folder
app.use(express.static('public'));

// Store rooms and users
const rooms = {};

io.on('connection', (socket) => {
    console.log('✅ User connected:', socket.id);

    // Join a room
    socket.on('joinRoom', (roomName, callback) => {
        // Leave any previous room
        if (socket.room) {
            socket.leave(socket.room);
            if (rooms[socket.room]) {
                rooms[socket.room] = rooms[socket.room].filter(id => id !== socket.id);
                io.to(socket.room).emit('userLeft', socket.id);
            }
        }

        // Create or join room
        if (!rooms[roomName]) {
            rooms[roomName] = [];
        }

        socket.join(roomName);
        socket.room = roomName;
        rooms[roomName].push(socket.id);

        // Notify others
        socket.to(roomName).emit('userJoined', socket.id);

        // Send current users to the new user
        const users = rooms[roomName].filter(id => id !== socket.id);
        socket.emit('roomUsers', users);

        console.log(`📢 User ${socket.id} joined room: ${roomName}`);
        if (callback) callback({ success: true, users: users });
    });

    // Handle text messages
    socket.on('sendMessage', (data) => {
        const room = socket.room;
        if (!room) return;
        io.to(room).emit('message', {
            sender: data.sender || socket.id.slice(0, 6),
            text: data.text,
            time: new Date().toISOString()
        });
    });

    // Handle voice messages
    socket.on('sendVoice', (data) => {
        const room = socket.room;
        if (!room) return;
        io.to(room).emit('voice', {
            sender: data.sender || socket.id.slice(0, 6),
            audio: data.audio,
            time: new Date().toISOString()
        });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('❌ User disconnected:', socket.id);
        if (socket.room && rooms[socket.room]) {
            rooms[socket.room] = rooms[socket.room].filter(id => id !== socket.id);
            socket.to(socket.room).emit('userLeft', socket.id);
            if (rooms[socket.room].length === 0) {
                delete rooms[socket.room];
            }
        }
    });

    // Handle leave room
    socket.on('leaveRoom', () => {
        if (socket.room && rooms[socket.room]) {
            rooms[socket.room] = rooms[socket.room].filter(id => id !== socket.id);
            socket.to(socket.room).emit('userLeft', socket.id);
            socket.leave(socket.room);
            socket.room = null;
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
