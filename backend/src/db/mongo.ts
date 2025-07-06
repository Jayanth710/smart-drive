import mongoose from 'mongoose';
import logger from '../logger.js';

const MONGO_URI = process.env.MONGO_URI! || ""

if(!MONGO_URI){
    logger.error("Error connecting to MongoDB. Check the URL.")
}

const connectDB = async () => {
    await mongoose.connect(MONGO_URI)
    .then(()=>{
        logger.info("DB Connected")
    })
    .catch(()=>{
        logger.error("Error in connection")
    })
}

export default connectDB;