const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

app.use(express.static('public'));

// Store active channels and their hosts
const channels = {};

io.on('connection', (socket) => {
    console.log('✅ User connected:', socket.id);

    // --- Host: Create a channel ---
    socket.on('hostChannel', (channelName, deviceId, callback) => {
        // Check if channel already exists
        if (channels[channelName]) {
            console.log(`❌ Channel ${channelName} already exists`);
            if (callback) callback({ success: false, error: 'Channel already exists' });
            return;
        }

        // Create the channel with this socket as host
        channels[channelName] = {
            hostId: socket.id,
            hostDeviceId: deviceId || socket.id.slice(0, 6),
            users: [socket.id],
            deviceIds: [deviceId || socket.id.slice(0, 6)],
            created: new Date().toISOString()
        };

        socket.join(channelName);
        socket.room = channelName;
        socket.role = 'host';
        socket.deviceId = deviceId || socket.id.slice(0, 6);

        console.log(`👑 User ${socket.deviceId} hosted channel: ${channelName}`);

        if (callback) callback({ 
            success: true, 
            role: 'host',
            channel: channelName,
            channelId: channelName // Use channel name as ID for simplicity
        });
    });

    // --- Joiner: Join a channel ---
    socket.on('joinChannel', (channelName, deviceId, callback) => {
        // Check if channel exists
        if (!channels[channelName]) {
            console.log(`❌ Channel ${channelName} not found`);
            if (callback) callback({ success: false, error: 'Channel not found' });
            return;
        }

        // Check if user is already in the channel
        if (channels[channelName].users.includes(socket.id)) {
            if (callback) callback({ success: false, error: 'Already in this channel' });
            return;
        }

        // Add user to channel
        channels[channelName].users.push(socket.id);
        channels[channelName].deviceIds.push(deviceId || socket.id.slice(0, 6));

        socket.join(channelName);
        socket.room = channelName;
        socket.role = 'joiner';
        socket.deviceId = deviceId || socket.id.slice(0, 6);

        // Notify everyone in the channel
        io.to(channelName).emit('userJoined', {
            userId: socket.deviceId,
            users: channels[channelName].deviceIds,
            hostId: channels[channelName].hostDeviceId
        });

        console.log(`👤 User ${socket.deviceId} joined channel: ${channelName}`);

        if (callback) callback({ 
            success: true, 
            role: 'joiner',
            channel: channelName,
            host: channels[channelName].hostDeviceId,
            users: channels[channelName].deviceIds
        });
    });

    // --- Send message ---
    socket.on('sendMessage', (data) => {
        const room = socket.room;
        if (!room || !channels[room]) return;
        
        io.to(room).emit('message', {
            sender: socket.deviceId || socket.id.slice(0, 6),
            role: socket.role,
            text: data.text,
            time: new Date().toISOString()
        });
    });

    // --- Send voice ---
    socket.on('sendVoice', (data) => {
        const room = socket.room;
        if (!room || !channels[room]) return;
        
        io.to(room).emit('voice', {
            sender: socket.deviceId || socket.id.slice(0, 6),
            role: socket.role,
            audio: data.audio,
            time: new Date().toISOString()
        });
    });

    // --- Disconnect ---
    socket.on('disconnect', () => {
        console.log('❌ User disconnected:', socket.deviceId || socket.id);
        
        if (socket.room && channels[socket.room]) {
            // If host disconnects, the channel is destroyed
            if (socket.role === 'host') {
                console.log(`💥 Channel ${socket.room} destroyed (host left)`);
                io.to(socket.room).emit('channelDestroyed', 'Host left the channel');
                io.to(socket.room).disconnectSockets();
                delete channels[socket.room];
            } else {
                // Remove joiner from channel
                channels[socket.room].users = channels[socket.room].users.filter(id => id !== socket.id);
                channels[socket.room].deviceIds = channels[socket.room].deviceIds.filter(id => id !== socket.deviceId);
                
                io.to(socket.room).emit('userLeft', {
                    userId: socket.deviceId || socket.id.slice(0, 6),
                    users: channels[socket.room].deviceIds
                });
                
                // If channel is empty, destroy it
                if (channels[socket.room].users.length === 0) {
                    console.log(`💥 Channel ${socket.room} destroyed (empty)`);
                    delete channels[socket.room];
                }
            }
            socket.leave(socket.room);
            socket.room = null;
        }
    });

    // --- Leave channel (joiner only) ---
    socket.on('leaveChannel', () => {
        if (socket.room && channels[socket.room] && socket.role === 'joiner') {
            channels[socket.room].users = channels[socket.room].users.filter(id => id !== socket.id);
            channels[socket.room].deviceIds = channels[socket.room].deviceIds.filter(id => id !== socket.deviceId);
            
            io.to(socket.room).emit('userLeft', {
                userId: socket.deviceId || socket.id.slice(0, 6),
                users: channels[socket.room].deviceIds
            });
            
            socket.leave(socket.room);
            console.log(`👋 User ${socket.deviceId} left channel: ${socket.room}`);
            socket.room = null;
            socket.role = null;
        }
    });

    // --- Get list of active channels (for host to check if name is taken) ---
    socket.on('checkChannel', (channelName, callback) => {
        if (callback) {
            callback({ exists: !!channels[channelName] });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
