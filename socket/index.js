require('dotenv').config({ path: "./.env" });
const SocketServer = require('./socket');

// CREATE INSTANCE (this runs constructor → DB connect, middleware, events, etc)
const server = new SocketServer();

// START LISTENING ON PORT
server.start();
