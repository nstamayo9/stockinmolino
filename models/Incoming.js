const mongoose = require('mongoose');

// This schema defines a single Incoming document (a waybill)
const IncomingSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      default: Date.now,
    },
    waybillNo: {
      type: String,
      required: true,
      unique: true, // unique constraint for waybill numbers
      trim: true,
    },
    count: {
      type: Number,
      required: true, // Total quantity or number of distinct items
      min: 0,
    },
    uom: {
      type: String,
      required: true, // UOM for the overall 'count' or main waybill
      trim: true,
    },
    // Array of sub-documents, each representing an item within the waybill
    items: [
      {
        productName: { type: String, required: true, trim: true },
        incoming: { type: Number, required: true, min: 0 }, // Quantity for this product
        uomIncoming: { type: String, required: true, trim: true }, // UOM for this product
        actualCount: { type: Number, default: 0, min: 0 }, // Actual counted quantity
        remarkActual: { type: String, default: "", trim: true }, // Remarks for actual count
      },
    ],

    // Status of the waybill (OPEN / CLOSED)
    status: {
      type: String,
      enum: ["OPEN", "CLOSED"],
      default: "OPEN",
    },

    // Timestamp when the waybill was closed
    closedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true } // Automatically adds createdAt and updatedAt
);

// Export a function that accepts a specific Mongoose connection
module.exports = (connection) => {
  return connection.model('Incoming', IncomingSchema);
};
