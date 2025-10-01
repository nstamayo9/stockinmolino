const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  category: { type: String, required: true },
  categoryNormalized: { type: String, lowercase: true, trim: true, index: true }, // lowercase for lookups, trim for consistency
  productName: { type: String, required: true, unique: true }, // Added unique constraint
  productNameNormalized: { type: String, lowercase: true, trim: true, index: true }, // lowercase for lookups, trim for consistency

  // >>> ADDED BY HUGSEESTRADE INTEGRATION <<<
  sku: { type: String, unique: true, sparse: true, trim: true, uppercase: true, minlength: 3 },
  barcode: { type: String, unique: true, sparse: true, trim: true },
  description: { type: String, trim: true, default: '' },
  supplier: { type: String, trim: true, default: 'Unknown' },
  purchasePrice: { type: Number, min: 0, default: 0 },
  sellingPrice: { type: Number, min: 0, default: 0 },
  stockQuantity: { type: Number, required: true, min: 0, default: 0 }, // Stock is managed by HugseesTrade
  baseUnit: { type: String, required: true, trim: true, default: 'Piece' },
  reorderLevel: { type: Number, min: 0, default: 5 },
  imageUrl: { type: String, trim: true, default: '/img/placeholder.png' },
  status: { type: String, enum: ['Active', 'Inactive', 'Discontinued'], default: 'Active' },
  // >>> END HUGSEESTRADE ADDITIONS <<<
}, { timestamps: true }); // Uses timestamps to get createdAt and updatedAt

// Add a pre-save hook to ensure normalized fields are always set/updated
productSchema.pre('save', function(next) {
  if (this.isModified('category') || this.isNew) {
    this.categoryNormalized = this.category ? this.category.toLowerCase().trim() : '';
  }
  if (this.isModified('productName') || this.isNew) {
    this.productNameNormalized = this.productName ? this.productName.toLowerCase().trim() : '';
  }
  next();
});

productSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  if (update.category) {
    update.categoryNormalized = update.category.toLowerCase().trim();
  }
  if (update.productName) {
    update.productNameNormalized = update.productName.toLowerCase().trim();
  }
  next();
});

module.exports = mongoose.model('Product', productSchema);
