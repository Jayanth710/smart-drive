import mongoose from "mongoose";

const summarySchema = new mongoose.Schema({
    FileName: String,
    FileExtension: String,
    UploadedAt: String,
    Summary: String,
    Summary_Embedding: [Number]
}, { strict: false });

const SummaryModel = mongoose.model('Summary', summarySchema, 'summaries');

export default SummaryModel;