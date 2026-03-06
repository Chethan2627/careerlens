const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, unique: true },
  name:        { type: String, required: true },
  email:       { type: String, default: '' },
  phone:       { type: String, default: '' },
  photo:       { type: String, default: '' },
  loginMethod: { type: String, enum: ['google', 'phone'], required: true },
  scanHistory: [
    {
      targetRole:    String,
      degree:        String,
      overallScore:  Number,
      grade:         String,
      scannedAt:     { type: Date, default: Date.now },
    }
  ],
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);