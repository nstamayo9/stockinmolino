const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  type: { type: String, enum: ['sale', 'purchase', 'return', 'wastage', 'transfer'], required: true },
  reason: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  items: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true },
    discount: { type: Number, default: 0 },
  }],
  totalAmount: { type: Number, required: true },
  paymentMethod: { type: String, enum: ['cash', 'card', 'e-wallet', 'split'] },
  paymentDetails: { type: mongoose.Schema.Types.Mixed },  // Encrypted in service
  stockAdjustment: { type: Number, required: true },  // e.g., -quantity for sale
  timestamp: { type: Date, default: Date.now },
  status: { type: String, enum: ['pending', 'completed', 'refunded'], default: 'pending' },
});

// Indexes
transactionSchema.index({ type: 1, timestamp: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);