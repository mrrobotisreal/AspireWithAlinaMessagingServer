const https = require('https');
const http = require('http'); // for testing locally only
const fs = require('fs');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { User } = require('./models/user');
const { Room } = require('./models/room');
const { Message } = require('./models/message');
const registerUser = require('./errorHandlers/registerUser');
const listChats = require('./errorHandlers/listChats');
const listMessages = require('./errorHandlers/listMessages');
const readMessages = require('./errorHandlers/readMessages');

// const certFile = fs.readFileSync(
//     '/etc/letsencrypt/live/aspirewithalina.com/fullchain.pem'
// );
// const keyFile = fs.readFileSync(
//     '/etc/letsencrypt/live/aspirewithalina.com/privkey.pem'
// );

// const server = https.createServer({
//     cert: certFile,
//     key: keyFile,
// });
const server = http.createServer(); // for testing locally only
const io = new Server(server);
mongoose.connect('mongodb://localhost:27017/chat'); // will be aspireDB when ready

io.on('connection', (socket) => {
    console.log(`User ${socket.id} connected`);

    socket.on(
        'registerUser',
        async ({
            userId,
            userType,
            preferredName,
            firstName,
            lastName,
            profilePictureUrl,
        }) => {
            const { errorMessage, paramsExist } =
                registerUser.checkRequiredParams({
                    userId,
                    userType,
                    preferredName,
                    firstName,
                    lastName,
                });
            if (!paramsExist) {
                socket.emit(
                    'registerUserError',
                    `Error during registerUser: ${errorMessage}`
                );
                return;
            }
            let user = await User.findOne({
                userId: userId,
                userType: userType,
            });
            if (!user) {
                // console.log('User not found. Creating new user...');
                user = new User({
                    userId: userId,
                    userType: userType,
                    preferredName: preferredName,
                    firstName: firstName,
                    lastName: lastName,
                    profilePictureUrl: profilePictureUrl,
                });
                // console.log('New user created:', user);
            }
            user.socketId = socket.id;
            // console.log(
            //     `Adding socketId ${socket.id} to user ${userId} and saving...`
            // );
            await user.save();
            // console.log(
            //     `${firstName} ${lastName} has been registered and is online!`
            // );
            socket.emit('userRegistered', { userId });
        }
    );

    socket.on('listChatRooms', async ({ userId }) => {
        console.log('Listing chat rooms...');
        try {
            const { errorMessage, paramsExist } = listChats.checkRequiredParams(
                { userId }
            );
            // console.log(
            //     'Do required params exist?',
            //     paramsExist ? 'Yes' : 'No'
            // );
            if (!paramsExist) {
                // console.log(
                //     'Error during listChats:',
                //     errorMessage,
                //     'Sending error message to client...'
                // );
                socket.emit(
                    'listChatsError',
                    `Error during listChats: ${errorMessage}`
                );
                return;
            }

            // console.log('Searching for user:', userId);
            const requestingUser = await User.findOne({ userId });
            if (!requestingUser) {
                // console.log(
                //     'User not found. Sending error message to client...'
                // );
                socket.emit(
                    'listChatsError',
                    `Error during listChats: User not found`
                );
                return;
            }
            // console.log(
            //     `User ${requestingUser.preferredName} (${requestingUser.firstName} ${requestingUser.lastName}) found. Fetching chat rooms...`
            // );

            const rooms = await Room.find({ users: requestingUser._id })
                .populate({
                    path: 'users',
                    select: 'userId userType preferredName firstName lastName profilePictureUrl',
                })
                .populate({
                    path: 'messages',
                    options: { sort: { timestamp: -1 } },
                });
            // console.log('Chat rooms fetched:', JSON.stringify(rooms, null, 2));

            const chatRooms = rooms.map((room) => {
                // console.log('Mapping chat summaries...');
                const chatId = room.roomId;
                const participants = room.users
                    .filter((user) => user.userId !== requestingUser.userId)
                    .map((user) => ({
                        userId: user.userId,
                        userType: user.userType,
                        preferredName: user.preferredName,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        profilePictureUrl: user.profilePictureUrl || '',
                    }));
                // console.log(
                //     'Participants in room:',
                //     JSON.stringify(participants, null, 2)
                // );
                const latestMessage = room.messages[0];
                // console.log(
                //     'Latest message in room:',
                //     JSON.stringify(latestMessage, null, 2)
                // );

                return {
                    chatId,
                    participants,
                    latestMessage: latestMessage
                        ? {
                              messageId: latestMessage.messageId,
                              chatId,
                              sender: latestMessage.sender,
                              content: latestMessage.content,
                              timestamp: latestMessage.timestamp,
                              isReceived: latestMessage.isReceived,
                              isRead: latestMessage.isRead,
                              isDeleted: latestMessage.isDeleted,
                          }
                        : null,
                };
            });

            socket.emit('chatsList', chatRooms);
        } catch (error) {
            console.log('Error listing chats:', error);
            socket.emit('listChatsError', `Error during listChats: ${error}`);
        }
    });

    socket.on('listMessages', async ({ roomId, userId }) => {
        // console.log('Listing messages...');
        try {
            const { errorMessage, paramsExist } =
                listMessages.checkRequiredParams({ roomId });
            if (!paramsExist) {
                // console.log(
                //     'Error during listMessages:',
                //     errorMessage,
                //     'Sending error message to client...'
                // );
                socket.emit(
                    'listMessagesError',
                    `Error during listMessages: ${errorMessage}`
                );
                return;
            }
            // console.log('Searching for room:', roomId);
            const room = await Room.findOne({ roomId })
                .populate({
                    path: 'users',
                    select: 'userId userType preferredName firstName lastName profilePictureUrl',
                })
                .populate({
                    path: 'messages',
                    options: { sort: { timestamp: -1 } },
                });
            if (!room) {
                // console.log(
                //     'Room not found. Sending error message to client...'
                // );
                socket.emit(
                    'listMessagesError',
                    `Error during listMessages: Room not found`
                );
                return;
            }
            const participants = room.users
                .filter((user) => user.userId !== userId)
                .map((user) => ({
                    userId: user.userId,
                    userType: user.userType,
                    preferredName: user.preferredName,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    profilePictureUrl: user.profilePictureUrl || '',
                }));
            const messages = [];
            for (let i = room.messages.length - 1; i >= 0; i--) {
                const sender = await User.findOne({
                    _id: room.messages[i].sender,
                });
                const message = {
                    messageId: room.messages[i].messageId,
                    chatId: room.roomId,
                    sender: {
                        userId: sender.userId,
                        userType: sender.userType,
                        preferredName: sender.preferredName,
                        firstName: sender.firstName,
                        lastName: sender.lastName,
                        profilePictureUrl: sender.profilePictureUrl || '',
                    },
                    content: room.messages[i].content,
                    timestamp: room.messages[i].timestamp,
                    isReceived: room.messages[i].isReceived,
                    isRead: room.messages[i].isRead,
                    isDeleted: room.messages[i].isDeleted,
                };
                // console.log('Message:', JSON.stringify(message, null, 2));
                messages.push(message);
            }
            const response = {
                chatId: room.roomId,
                participants,
                messagesList: messages,
            };
            socket.emit('messagesList', response);
        } catch (error) {
            console.log('Error listing messages:', error);
            socket.emit(
                'listMessagesError',
                `Error during listMessages: ${error}`
            );
        }
    });

    socket.on('sendMessage', async ({ roomId, sender, message, timestamp }) => {
        // console.log('Sending message...');
        try {
            const senderData = await User.findOne({ userId: sender.userId });
            const room = await Room.findOne({ roomId }).populate('users');
            if (!room) {
                // console.log(
                //     'Room not found. Sending error message to client...'
                // );
                socket.emit(
                    'sendMessageError',
                    `Error during sendMessage: Room not found`
                );
                return;
            }

            const newMessage = new Message({
                messageId: uuidv4(),
                roomId,
                sender: senderData._id,
                content: message,
                timestamp,
                isReceived: false,
                isRead: false,
                isDeleted: false,
            });
            await newMessage.save();

            room.messages.push(newMessage._id);
            await room.save();

            const updatedRoom = await Room.findOne({ roomId })
                .populate({
                    path: 'users',
                    select: 'userId userType preferredName firstName lastName profilePictureUrl',
                })
                .populate({
                    path: 'messages',
                    options: { sort: { timestamp: -1 } },
                });
            const roomResponse = {};
            const roomResponseUsers = [];
            const roomResponseMessages = [];

            for (let i = 0; i < updatedRoom.users.length; i++) {
                const roomUser = updatedRoom.users[i];
                roomResponseUsers.push({
                    userId: roomUser.userId,
                    userType: roomUser.userType,
                    preferredName: roomUser.preferredName,
                    firstName: roomUser.firstName,
                    lastName: roomUser.lastName,
                    profilePictureUrl: roomUser.profilePictureUrl || '',
                });
            }
            for (let i = updatedRoom.messages.length - 1; i >= 0; i--) {
                const roomMessage = updatedRoom.messages[i];
                const msgSender = await User.findOne({
                    _id: roomMessage.sender,
                });
                roomResponseMessages.push({
                    messageId: roomMessage.messageId,
                    chatId: roomMessage.roomId,
                    sender: {
                        userId: msgSender.userId,
                        userType: msgSender.userType,
                        preferredName: msgSender.preferredName,
                        firstName: msgSender.firstName,
                        lastName: msgSender.lastName,
                        profilePictureUrl: msgSender.profilePictureUrl || '',
                    },
                    content: roomMessage.content,
                    timestamp: roomMessage.timestamp,
                    isReceived: roomMessage.isReceived,
                    isRead: roomMessage.isRead,
                    isDeleted: roomMessage.isDeleted,
                });
            }
            roomResponse.chatId = updatedRoom.roomId;
            roomResponse.participants = roomResponseUsers;
            roomResponse.messages = roomResponseMessages;

            room.users.forEach((user) => {
                io.to(user.socketId).emit('newMessage', roomResponse);
            });
        } catch (error) {
            console.log('Error sending message:', error);
            socket.emit(
                'sendMessageError',
                `Error during sendMessage: ${error}`
            );
        }
    });

    socket.on('readMessages', async ({ roomId, unreadMessages }) => {
        try {
            console.log('Reading messages...', unreadMessages);
            const { errorMessage, paramsExist } =
                readMessages.checkRequiredParams({ roomId, unreadMessages });
            if (!paramsExist) {
                console.log(
                    'Error during readMessages:',
                    errorMessage,
                    'Sending error message to client...'
                );
                socket.emit(
                    'readMessagesError',
                    `Error during readMessages: ${errorMessage}`
                );
                return;
            }
            let messagesNotFound = false;
            for (let i = 0; i < unreadMessages.length; i++) {
                console.log('Marking message as read:', unreadMessages[i]);
                const message = await Message.findOne({
                    messageId: unreadMessages[i],
                });
                if (!message) {
                    console.log(
                        `Message ${unreadMessages[i]} not found. Skipping...`
                    );
                    messagesNotFound = true;
                    continue;
                }
                console.log('Message found:', JSON.stringify(message, null, 2));
                message.isReceived = true;
                message.isRead = true;
                await message.save();
                console.log('Message saved...');
            }
            const room = await Room.findOne({ roomId })
                .populate('users')
                .populate({
                    path: 'messages',
                    options: { sort: { timestamp: -1 } },
                });
            if (!room) {
                console.log(
                    'Room not found. Sending error message to client...'
                );
                socket.emit(
                    'readMessagesError',
                    `Error during readMessages: Room not found`
                );
                return;
            }
            const roomResponse = {};
            const roomResponseUsers = [];
            const roomResponseMessages = [];
            for (let i = 0; i < room.users.length; i++) {
                const roomUser = room.users[i];
                roomResponseUsers.push({
                    userId: roomUser.userId,
                    userType: roomUser.userType,
                    preferredName: roomUser.preferredName,
                    firstName: roomUser.firstName,
                    lastName: roomUser.lastName,
                    profilePictureUrl: roomUser.profilePictureUrl || '',
                });
            }
            for (let i = room.messages.length - 1; i >= 0; i--) {
                const roomMessage = room.messages[i];
                const msgSender = await User.findOne({
                    _id: roomMessage.sender,
                });
                roomResponseMessages.push({
                    messageId: roomMessage.messageId,
                    chatId: roomMessage.roomId,
                    sender: {
                        userId: msgSender.userId,
                        userType: msgSender.userType,
                        preferredName: msgSender.preferredName,
                        firstName: msgSender.firstName,
                        lastName: msgSender.lastName,
                        profilePictureUrl: msgSender.profilePictureUrl || '',
                    },
                    content: roomMessage.content,
                    timestamp: roomMessage.timestamp,
                    isReceived: roomMessage.isReceived,
                    isRead: roomMessage.isRead,
                    isDeleted: roomMessage.isDeleted,
                });
            }
            roomResponse.chatId = room.roomId;
            roomResponse.participants = roomResponseUsers;
            roomResponse.messagesList = roomResponseMessages;
            room.users.forEach((user) => {
                if (user.socketId && user.socketId !== socket.id) {
                    // TODO: on client side, add logic to check if user is currently viewing the chat room and if not, updated icon to indicate unread messages
                    // io.to(user.socketId).emit('chatsList', {
                    //     chatId: room.roomId,
                    //     participants: roomResponseUsers,
                    //     latestMessage: roomResponseMessages[0],
                    // });
                    io.to(user.socketId).emit('messagesList', roomResponse);
                }
            });
        } catch (error) {
            console.log('Error reading messages:', error);
            socket.emit(
                'readMessagesError',
                `Error during readMessages: ${error}`
            );
        }
    });

    socket.on(
        'createChatRoom',
        async ({ sender, participants, message, timestamp }) => {
            console.log('Creating chat room...');
            console.log(
                'Searching for room with users:',
                sender,
                ...participants
            );
            const sendingUser = await User.findOne({ userId: sender.userId }); // TODO: handle error if no user
            const roomUserIds = participants
                .filter((participant) => participant.userId !== sender.userId)
                .map(async (participant) => {
                    const user = await User.findOne({
                        userId: participant.userId,
                    }); // TODO: handle error if no user
                    return user._id;
                });
            let room = await Room.findOne({
                users: {
                    $all: [sendingUser._id, ...roomUserIds],
                },
            });
            if (!room) {
                console.log('Room not found. Creating new room...');
                room = new Room({
                    roomId: uuidv4(),
                    users: [sendingUser._id, ...roomUserIds],
                });
                await room.save();
            }

            console.log('Creating new message...');
            const newMessage = new Message({
                messageId: uuidv4(),
                roomId: room.roomId,
                sender: sendingUser._id,
                content: message,
                timestamp: timestamp,
                isReceived: false,
                isRead: false,
                isDeleted: false,
            });
            await newMessage.save();
            console.log('Message created and saved:', newMessage);

            room.messages.push(newMessage._id);
            await room.save();

            socket.emit('chatRoomCreated');

            console.log('Sending message to participants...');
            participants.forEach(async (participant) => {
                console.log('Searching for participant:', participant.userId);
                const participantData = await User.findOne({
                    userId: participant.userId,
                });
                if (participantData && participantData.socketId) {
                    console.log('Participant found. Sending message...');
                    io.to(participantData.socketId).emit('joinChatRoom', {
                        roomId: room.roomId,
                        participants: [
                            sender,
                            ...participants.filter(
                                (user) => user.userId !== participant.userId
                            ),
                        ],
                        message,
                    });
                } else {
                    console.log(
                        `User ${participant.userId} is not online. Message will be sent when they are online.`
                    );
                }
            });
        }
    );

    socket.on('fetchMissedMessages', async (userId) => {
        console.log('Fetching missed messages...');
        console.log('Searching for user:', userId);
        const user = await User.findOne({ userId });
        if (user) {
            console.log('User found. Fetching missed messages...');
            const rooms = await Room.find({ users: userId }).populate(
                'messages'
            );
            rooms.forEach((room) => {
                const missedMessages = room.messages.filter(
                    (msg) => msg.sender !== userId
                );
                if (missedMessages.length > 0) {
                    socket.emit('missedMessages', {
                        roomId: room.roomId,
                        messages: missedMessages,
                    });
                }
            });
        }
    });

    socket.on('joinChatRoom', async ({ roomId, participants }) => {});

    socket.on('disonnect', () => {
        const userID = Object.keys(userSockets).find(
            (key) => userSockets[key] === socket.id
        );
        if (userID) {
            delete userSockets[userID];
            console.log(`User ${userID} disconnected`);
        }
    });
});

server.listen(11114, () => {
    console.log(
        'WebSocket server started securely on https://localhost:11114/chat' // for testing locally only, prod is :11112/chat
    );
});