const mongoose = require("mongoose");

module.exports = (connection) => {
  const actualCountSchema = new mongoose.Schema(
    {
      waybillId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Incoming",
        required: true,
      },
      productName: { type: String, required: true },
      counts: { type: [Number], default: [] }, // e.g. [5, 10, 2]
      total: { type: Number, default: 0 },
      remarkActual: { type: String, default: "" },
      savedAt: { type: Date, default: Date.now },

      // >>> ADDED BY HUGSEESTRADE INTEGRATION <<<
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', sparse: true }, // Link to Product._id
      // >>> END HUGSEESTRADE ADDITIONS <<<
    },
    { timestamps: true }
  );

  // Return the model using the provided connection
  return connection.model("Count", actualCountSchema); // <<< Note: Your stockinmolino names this model "Count"
};
