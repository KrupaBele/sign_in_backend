import mongoose from 'mongoose';

const signatureSchema = new mongoose.Schema({
  signerEmail: {
    type: String,
    required: true
  },
  signerName: {
    type: String,
    required: true
  },
  signatureData: {
    type: String,
    required: true
  },
  position: {
    x: Number,
    y: Number,
    page: Number
  },
  signedAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'signed'],
    default: 'pending'
  }
});

const documentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  originalUrl: {
    type: String,
    required: true
  },
  signedUrl: {
    type: String
  },
  cloudinaryId: {
    type: String,
    required: true
  },
  ownerEmail: {
    type: String,
    required: true
  },
  signatures: [signatureSchema],
  recipients: [{
    email: String,
    name: String,
    status: {
      type: String,
      enum: ['pending', 'sent', 'signed'],
      default: 'pending'
    }
  }],
  status: {
    type: String,
    enum: ['draft', 'sent', 'completed'],
    default: 'draft'
  },
  note: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date
});

export default mongoose.model('Document', documentSchema);