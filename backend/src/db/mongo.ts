import mongoose from 'mongoose';
import logger from '../logger.js';

const MONGO_URI = process.env.MONGO_URI || "";

const connectDB = async () => {
    if (!MONGO_URI) {
        logger.error("MONGO_URI is not set. Refusing to start.");
        process.exit(1);
    }
    try {
        await mongoose.connect(MONGO_URI);
        logger.info("DB Connected");
    } catch (error) {
        logger.error("Failed to connect to MongoDB:", error);
        process.exit(1);
    }
};

export default connectDB;