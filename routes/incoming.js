// routes/incoming.js
const express = require("express");
const router = express.Router();
const dayjs = require("dayjs");
const mongoose = require("mongoose");

// Import both models
const Incoming = require("../models/Incoming")(mongoose.connection);
const Count = require("../models/Count")(mongoose.connection);

module.exports = () => {
  // GET Incoming Count page
  router.get("/incoming/count", async (req, res) => {
    try {
      const waybills = await Incoming.find().lean();
      res.render("incoming_count", { waybills });
    } catch (err) {
      console.error("Error fetching waybills:", err);
      res.status(500).send("Server Error");
    }
  });

  // POST Save Actual Counts + Remarks
  router.post("/incoming/count/save", async (req, res) => {
    try {
      const { waybillId, counts, remarksActual } = req.body;
      const waybill = await Incoming.findById(waybillId);
      if (!waybill) return res.status(404).send("Waybill not found");

      // Update Incoming collection
      waybill.items.forEach((item) => {
        // Actual Count
        const rawValue =
          counts && counts[item.productName] ? counts[item.productName] : "";
        const numbers = rawValue
          .split(",")
          .map((n) => parseInt(n.trim()))
          .filter((n) => !isNaN(n));
        item.actualCount = numbers.reduce((sum, val) => sum + val, 0);

        // RemarksActual
        if (remarksActual && remarksActual[item.productName]) {
          item.remarksActual = remarksActual[item.productName];
        }
      });

      await waybill.save();

      // Also insert into "counts" collection
      const formattedDate = new Date(waybill.date).toLocaleDateString("en-US", {
        month: "long",
        day: "2-digit",
        year: "numeric",
      });

      const countDocs = waybill.items.map((item) => ({
        waybillNo: waybill.waybillNo,
        count: waybill.count,
        uom: waybill.uom,
        date: formattedDate,
        productName: item.productName,
        actualCount: item.actualCount,
        remarksActual: item.remarksActual || "",
      }));

      await Count.insertMany(countDocs);

      res.redirect("/incoming/report");
    } catch (err) {
      console.error("Error saving actual counts:", err);
      res.status(500).send("Error saving actual counts");
    }
  });

  // GET Incoming Report
  router.get("/incoming/report", async (req, res) => {
    try {
      const waybills = await Incoming.find().lean();
      res.render("incoming_report", { waybills, dayjs });
    } catch (err) {
      console.error("Error fetching report:", err);
      res.status(500).send("Server Error");
    }
  });

  return router;
};
