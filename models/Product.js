// models/Product.js
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  category: { type: String, required: true },
  categoryNormalized: { type: String, lowercase: true, trim: true, index: true }, // lowercase for lookups, trim for consistency
  productName: { type: String, required: true },
  productNameNormalized: { type: String, lowercase: true, trim: true, index: true }, // lowercase for lookups, trim for consistency
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