import mongoose from "mongoose";

const summarySchema = new mongoose.Schema({
    FileName: String,
    FileExtension: String,
    UploadedAt: String,
    Summary: String,
    Summary_Embedding: [Number] // This is the vector field
}, { strict: false }); // `strict: false` allows other fields not defined here

// Create a Mongoose model to interact with the 'summaries' collection.
const SummaryModel = mongoose.model('Summary', summarySchema, 'summaries');

export default SummaryModel;