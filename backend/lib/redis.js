const {createClient} =require("redis")
const client = createClient({
    username: 'default',
    password: process.env.REDIS_PASSWORD || '1lY8xBfnej1mqfBJYjHYYts7rmdxUCZj',
    socket: {
        host: 'redis-13524.crce199.us-west-2-2.ec2.cloud.redislabs.com',
        port: 13524,
        // REMOVE tls: true or set it to false
        tls: false, 
       keepAlive: 5000, // Sends a TCP keep-alive every 5 seconds
        reconnectStrategy: (retries) => {
            console.log(`🔄 Redis Reconnecting... Attempt: ${retries}`);
            return Math.min(retries * 200, 5000); // Wait longer between attempts
        }
    }
});

client.on('error', err => console.log('❌ Redis Client Error:', err));

// Connect without blocking the whole app start
client.connect()
    .then(() => {
        console.log('🚀 Redis Connected and Ready!');
    })
    .catch(err => {
        console.error('🔴 Failed to connect to Redis:', err);
    });

module.exports = client;// Export so controllers can use it