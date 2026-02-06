const User = require("../../models/user");
const { USER_EVENTS } = require("../../shared/constants");

class UserEventsHandler {
  constructor(io) {
    this.io = io;
  }

  registerEvents(socket) {
    const userId = socket.userId;

    console.log(`👤 Registering user events for: ${userId}`);

    // Set online status
    socket.on("set-online", async () => {
      await this.handleSetOnline(userId);
    });

    // Set away status
    socket.on("set-away", async () => {
      await this.handleSetAway(userId);
    });

    // Set busy status
    socket.on("set-busy", async () => {
      await this.handleSetBusy(userId);
    });

    // Set offline status
    socket.on("set-offline", async () => {
      await this.handleSetOffline(userId);
    });

    // Refresh last seen
    socket.on("refresh-last-seen", async () => {
      await this.handleRefreshLastSeen(userId);
    });
  }

  async handleSetOnline(userId) {
    const user = await User.findByIdAndUpdate(
      userId,
      {
        online: true,
        status: "online",
        lastSeen: new Date(),
        socketId: this.getSocketId(userId),
      },
      { new: true }
    ).select("username avatar status online lastSeen");

    if (user) {
      // Notify friends
      await this.notifyFriends(userId, true);

      this.io.emit(USER_EVENTS.USER_ONLINE, {
        userId,
        username: user.username,
        avatar: user.avatar,
        status: user.status,
        lastSeen: user.lastSeen,
      });
    }
  }

  async handleSetAway(userId) {
    const user = await User.findByIdAndUpdate(
      userId,
      {
        online: true,
        status: "chal ko chal ke dekha",
        lastSeen: new Date(),
      },
      { new: true }
    ).select("username avatar status online lastSeen");

    if (user) {
      await this.notifyFriends(userId, false);
      this.emitStatusChange(user);
    }
  }

  async handleSetBusy(userId) {
    const user = await User.findByIdAndUpdate(
      userId,
      {
        online: true,
        status: "busy",
        lastSeen: new Date(),
      },
      { new: true }
    ).select("username avatar status online lastSeen");

    if (user) {
      await this.notifyFriends(userId, false);
      this.emitStatusChange(user);
    }
  }

  async handleSetOffline(userId) {
    const user = await User.findByIdAndUpdate(
      userId,
      {
        online: false,
        status: "offline",
        lastSeen: new Date(),
        socketId: null,
      },
      { new: true }
    ).select("username avatar status online lastSeen");

    if (user) {
      await this.notifyFriends(userId, false);
      this.emitStatusChange(user);
    }
  }

  async handleRefreshLastSeen(userId) {
    await User.findByIdAndUpdate(userId, { lastSeen: new Date() });
  }

  async notifyFriends(userId, isOnline) {
    const user = await User.findById(userId).populate("friends", "socketId");
    if (user && user.friends) {
      user.friends.forEach((friend) => {
        if (friend.socketId) {
          this.io
            .to(friend.socketId)
            .emit(
              isOnline ? USER_EVENTS.FRIEND_ONLINE : USER_EVENTS.FRIEND_OFFLINE,
              {
                userId: user._id,
                username: user.username,
                status: user.status,
                online: user.online,
                lastSeen: user.lastSeen,
              }
            );
        }
      });
    }
  }

  emitStatusChange(user) {
    this.io.emit(USER_EVENTS.USER_STATUS_CHANGE, {
      userId: user._id,
      username: user.username,
      status: user.status,
      online: user.online,
      lastSeen: user.lastSeen,
    });
  }

  getSocketId(userId) {
    // Get socket ID from connected sockets
    const sockets = Array.from(this.io.sockets.sockets.values());
    const socket = sockets.find((s) => s.userId === userId);
    return socket ? socket.id : null;
  }
}

module.exports = UserEventsHandler;
