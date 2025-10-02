const express = require("express");
const router = express.Router();
const dayjs = require("dayjs");
const mongoose = require("mongoose"); // Ensure mongoose is available for ObjectId

// Import models - ensure all are factory functions and use the same connection
// Assuming models/Incoming.js and models/ActualCount.js (Count) are factory functions
const Incoming = require("../models/Incoming")(mongoose.connection);
const Count = require("../models/ActualCount")(mongoose.connection); // Your stockinmolino calls it Count, but we'll use the filename
// <<< CORRECTED: Product now loaded as a factory function using mongoose.connection >>>
const Product = require("../models/Product")(mongoose.connection); 

module.exports = () => {
  // GET Incoming Count page
  router.get("/incoming/count", async (req, res) => {
    try {
      const waybills = await Incoming.find().lean();
      res.render("incoming_count", { waybills, dayjs, currentUser: req.session.username, currentRole: req.session.role });
    } catch (err) {
      console.error("Error fetching waybills:", err);
      res.status(500).send("Server Error");
    }
  });

  // POST Save Actual Counts + Remarks
  router.post("/incoming/count/save", async (req, res) => {
    try {
      const { waybillId, counts, remarkActual } = req.body;
      if (!waybillId) return res.status(400).send("Waybill ID missing.");

      const waybill = await Incoming.findById(waybillId);
      if (!waybill) return res.status(404).send("Waybill not found.");

      for (const item of waybill.items) {
        const rawValue = counts?.[item.productName] || "";
        const numbers = rawValue
          .split(",")
          .map((n) => parseInt(n.trim()))
          .filter((n) => !isNaN(n));
        item.actualCount = numbers.reduce((sum, val) => sum + val, 0);

        item.remarkActual = remarkActual?.[item.productName] || "";

        // >>> HUGSEESTRADE INTEGRATION: Ensure productId and conversionFactor are present on save <<<
        if (!item.productId || !item.conversionFactor) { // Only attempt lookup if not already linked
            const product = await Product.findOne({ productName: item.productName });
            if (product) {
                item.productId = product._id;
                item.conversionFactor = product.conversionFactor || 1; // Assuming product.conversionFactor can exist in product model
            } else {
                console.warn(`[stockinmolino] Product "${item.productName}" not found during Incoming count save. productId/conversionFactor not set.`);
                item.productId = null;
                item.conversionFactor = 1; // Default
            }
        }
        // >>> END HUGSEESTRADE INTEGRATION <<<
      }

      await waybill.save();

      // Also insert into "counts" collection (our ActualCount model)
      const formattedDate = new Date(waybill.date).toLocaleDateString("en-US", {
        month: "long",
        day: "2-digit",
        year: "numeric",
      });

      const countDocs = [];
      for(const item of waybill.items) {
          const product = await Product.findOne({ productName: item.productName }); // Re-lookup Product for Count doc
          countDocs.push({
            waybillNo: waybill.waybillNo,
            count: waybill.count,
            uom: waybill.uom,
            date: formattedDate,
            productName: item.productName,
            actualCount: item.actualCount,
            remarkActual: item.remarkActual || "",
            productId: product ? product._id : null,
            waybillId: waybill._id
          });
      }

      for(const doc of countDocs) {
        await Count.findOneAndUpdate(
          { waybillId: doc.waybillId, productName: doc.productName },
          { $set: doc },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }

      res.redirect("/incoming/report");
    } catch (err) {
      console.error("Error saving actual counts:", err);
      res.status(500).send("Error saving actual counts");
    }
  });


  // ... (existing GET /incoming/report and GET /incoming/report/closed routes) ...

  // POST Route for adding new incoming waybills
  router.post("/incoming", async (req, res) => {
    try {
      const waybillsRaw = req.body.waybills;
      if (!waybillsRaw || Object.keys(waybillsRaw).length === 0)
        return res.status(400).send("No waybill data provided.");

      const waybillsToSave = [];
      for (const key in waybillsRaw) {
        if (!waybillsRaw[key].waybillNo || !waybillsRaw[key].count || !waybillsRaw[key].uom || !waybillsRaw[key].items)
          continue;

        const items = [];
        for (const itemData of waybillsRaw[key].items) {
          console.log(`[stockinmolino-routes/incoming.js] POST /incoming: Looking up Product for productName: "${itemData.productName}"`); // <<< Debug Log
          const product = await Product.findOne({ productName: itemData.productName }); // Use stockinmolino's Product model
          
          if (!product) {
            console.warn(`[stockinmolino-routes/incoming.js] WARNING: Product "${itemData.productName}" NOT FOUND in DB. Item will be saved with null productId.`); // <<< Debug Log
            items.push({
              productName: itemData.productName || "",
              incoming: Number(itemData.incoming) || 0,
              uomIncoming: itemData.uomIncoming || "",
              actualCount: itemData.actualCount ? Number(itemData.actualCount) : 0,
              remarkActual: itemData.remarkActual || "",
              productId: null, // Product not found, so productId is null
              conversionFactor: Number(itemData.conversionFactor) || 1 // Use provided or default
            });
          } else {
            console.log(`[stockinmolino-routes/incoming.js] Product "${itemData.productName}" FOUND (ID: ${product._id}).`); // <<< Debug Log
            items.push({
              productName: itemData.productName || "",
              incoming: Number(itemData.incoming) || 0,
              uomIncoming: itemData.uomIncoming || "",
              actualCount: itemData.actualCount ? Number(itemData.actualCount) : 0,
              remarkActual: itemData.remarkActual || "",
              productId: product._id, // Add the found Product ID
              conversionFactor: Number(itemData.conversionFactor) || 1 // Use provided or default
            });
          }
        }

        waybillsToSave.push({
          date: waybillsRaw[key].date ? new Date(waybillsRaw[key].date) : new Date(),
          waybillNo: waybillsRaw[key].waybillNo,
          count: Number(waybillsRaw[key].count),
          uom: waybillsRaw[key].uom,
          items,
          status: "OPEN",
        });
      }

      for (const wbData of waybillsToSave) {
        const doc = new Incoming(wbData);
        await doc.save();
        console.log(`[stockinmolino-routes/incoming.js] New Incoming document saved (ID: ${doc._id}).`); // <<< Debug Log
      }

      res.redirect("/incoming/new");
    } catch (err) {
      console.error("Error saving incoming data:", err);
      res.status(500).send("Error saving incoming data.");
    }
  });


  // ... (existing routes like app.get("/waybills/close/:id")) ...

  // POST Route for editing existing waybills
  router.post("/waybills/edit/:id", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
    try {
      const id = req.params.id;
      const wbRaw = req.body.waybills[0];
      if (!wbRaw) return res.status(400).send("No waybill data provided.");

      const items = [];
      for (const itemData of wbRaw.items) {
          console.log(`[stockinmolino-routes/incoming.js] POST /waybills/edit: Looking up Product for productName: "${itemData.productName}"`); // <<< Debug Log
          const product = await Product.findOne({ productName: itemData.productName });
          if (!product) {
              console.warn(`[stockinmolino-routes/incoming.js] WARNING: Product "${itemData.productName}" NOT FOUND during Incoming edit. Item will be saved with null productId.`); // <<< Debug Log
              items.push({
                productName: itemData.productName || "",
                incoming: Number(itemData.incoming) || 0,
                uomIncoming: itemData.uomIncoming || "",
                actualCount: itemData.actualCount ? Number(itemData.actualCount) : 0,
                remarkActual: itemData.remarkActual || "",
                productId: null,
                conversionFactor: Number(itemData.conversionFactor) || 1
              });
          } else {
              console.log(`[stockinmolino-routes/incoming.js] Product "${itemData.productName}" FOUND (ID: ${product._id}).`); // <<< Debug Log
              items.push({
                productName: itemData.productName || "",
                incoming: Number(itemData.incoming) || 0,
                uomIncoming: itemData.uomIncoming || "",
                actualCount: itemData.actualCount ? Number(itemData.actualCount) : 0,
                remarkActual: itemData.remarkActual || "",
                productId: product._id,
                conversionFactor: Number(itemData.conversionFactor) || 1
              });
          }
      }

      const updateData = {
        date: wbRaw.date ? new Date(wbRaw.date) : undefined,
        waybillNo: wbRaw.waybillNo,
        count: Number(wbRaw.count),
        uom: wbRaw.uom,
        items,
      };

      const result = await Incoming.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
      if (!result) return res.status(404).send("Waybill not found.");
      console.log(`[stockinmolino-routes/incoming.js] Incoming document updated (ID: ${result._id}).`); // <<< Debug Log
      res.redirect("/waybills");
    } catch (err) {
      console.error("Error updating waybill:", err);
      res.status(500).send("Error updating waybill.");
    }
  });

  return router;
};
