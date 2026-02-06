const mongoose =require("mongoose")

const MONGODB_URI = 'mongodb+srv://jharavi0605_db_user:google2026@cluster0.tjdwjnb.mongodb.net/?appName=Cluster0';

const connectDB = async () => {
    try {

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('🍃 MongoDB Connected successfully');
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err.message);
        process.exit(1); // Stop the app if DB fails
    }
};

module.exports=connectDB;