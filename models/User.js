// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true, // <-- Ensure this
    unique: true,
    trim: true
  },
  fullname: {
    type: String,
    required: true, // <-- Ensure this
    trim: true
  },
  email: {
    type: String,
    required: true, // <-- Ensure this
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true // <-- Ensure this
  },
  role: {
    type: String,
    enum: ['Super Admin', 'Admin', 'User'], // <-- IMPORTANT: These are the exact values
    required: true, // <-- Ensure this
    default: 'User' // Default only applies if not provided, but we are making it required
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Hash the password before saving (pre-save hook)
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);
module.exports = User;