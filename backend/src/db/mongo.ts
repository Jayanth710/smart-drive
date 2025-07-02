import mongoose from 'mongoose';
import logger from '../logger.js';

const MONGO_URI = process.env.MONGO_URI! || 'mongodb+srv://Jayanth:Saibaba@smartdrive-data.qzbq9qg.mongodb.net/?retryWrites=true&w=majority&appName=SmartDrive-data';

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