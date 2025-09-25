const mongoose = require('mongoose');

const WaybillSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  waybillNo: { type: String, required: true, unique: true },
  count: { type: Number, required: true },
  uom: { type: String, required: true },
  items: [
    {
      productName: { type: String, required: true },
      incoming: { type: Number, required: true },
      uomIncoming: { type: String, required: true },
    }
  ]
}, { timestamps: true });

module.exports = mongoose.model('Waybill', WaybillSchema);
