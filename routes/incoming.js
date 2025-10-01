const express = require("express");
const router = express.Router();
const dayjs = require("dayjs");
const mongoose = require("mongoose");

// Import models - ensure Product is imported here
const Incoming = require("../models/Incoming")(mongoose.connection);
const Count = require("../models/ActualCount")(mongoose.connection); // <<< Corrected: Assuming ActualCount.js defines Count model
const Product = require("../models/Product"); // <<< Added: Import Product model (uses default Mongoose connection)

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
      for (const item of waybill.items) { // Use for...of for async inside loop
        // Actual Count
        const rawValue = counts?.[item.productName] || "";
        const numbers = rawValue
          .split(",")
          .map((n) => parseInt(n.trim()))
          .filter((n) => !isNaN(n));
        item.actualCount = numbers.reduce((sum, val) => sum + val, 0);

        // RemarksActual
        item.remarkActual = remarksActual?.[item.productName] || "";

        // >>> HUGSEESTRADE INTEGRATION: Ensure productId and conversionFactor are present on save <<<
        if (!item.productId || !item.conversionFactor) {
            const product = await Product.findOne({ productName: item.productName });
            if (product) {
                item.productId = product._id;
                item.conversionFactor = product.conversionFactor || 1;
            } else {
                console.warn(`[stockinmolino] Product "${item.productName}" not found during Incoming count save. productId/conversionFactor not set.`);
                item.productId = null; // Set explicitly to null if not found
                item.conversionFactor = 1; // Default
            }
        }
        // >>> END HUGSEESTRADE INTEGRATION <<<
      }

      await waybill.save(); // This will save the updated Incoming document

      // Also insert into "counts" collection (our ActualCount model)
      const formattedDate = new Date(waybill.date).toLocaleDateString("en-US", {
        month: "long",
        day: "2-digit",
        year: "numeric",
      });

      const countDocs = [];
      for(const item of waybill.items) {
          const product = await Product.findOne({ productName: item.productName }); // Re-lookup Product
          countDocs.push({
            waybillNo: waybill.waybillNo,
            count: waybill.count, // This is top-level count
            uom: waybill.uom,     // This is top-level uom
            date: formattedDate,
            productName: item.productName,
            actualCount: item.actualCount,
            remarkActual: item.remarkActual || "",
            // >>> HUGSEESTRADE INTEGRATION: Add productId to Count document <<<
            productId: product ? product._id : null,
            waybillId: waybill._id
            // >>> END HUGSEESTRADE INTEGRATION <<<
          });
      }

      // Instead of insertMany, use findOneAndUpdate with upsert to avoid duplicates and ensure productId is added
      for(const doc of countDocs) {
        await Count.findOneAndUpdate(
          { waybillId: doc.waybillId, productName: doc.productName },
          { $set: doc }, // Update or set all fields
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
          // <<< HUGSEESTRADE INTEGRATION: Find Product ID and get Conversion Factor >>>
          const product = await Product.findOne({ productName: itemData.productName });
          if (!product) {
            console.warn(`[stockinmolino] Product "${itemData.productName}" not found during Incoming creation. Skipping item, or will have null productId.`);
            // Assign null productId and default conversionFactor if product not found
            items.push({
              productName: itemData.productName || "",
              incoming: Number(itemData.incoming) || 0,
              uomIncoming: itemData.uomIncoming || "",
              actualCount: itemData.actualCount ? Number(itemData.actualCount) : 0,
              remarkActual: itemData.remarkActual || "",
              productId: null, // Product not found, so productId is null
              conversionFactor: 1 // Default conversion factor
            });
            continue; // Skip to next item if product not found
          }
          // <<< END HUGSEESTRADE INTEGRATION >>>

          items.push({
            productName: itemData.productName || "",
            incoming: Number(itemData.incoming) || 0,
            uomIncoming: itemData.uomIncoming || "",
            actualCount: itemData.actualCount ? Number(itemData.actualCount) : 0,
            remarkActual: itemData.remarkActual || "",
            // <<< HUGSEESTRADE INTEGRATION: Add productId and conversionFactor >>>
            productId: product._id, // Add the found Product ID
            conversionFactor: product.conversionFactor || 1 // Use product's default conversionFactor if available
            // <<< END HUGSEESTRADE ADDITIONS >>>
          });
        }

        waybillsToSave.push({
          date: waybillsRaw[key].date ? new Date(waybillsRaw[key].date) : new Date(),
          waybillNo: waybillsRaw[key].waybillNo,
          count: Number(waybillsRaw[key].count),
          uom: waybillsRaw[key].uom,
          items,
          status: "OPEN", // Waybills are typically OPEN initially, then closed.
        });
      }

      for (const wbData of waybillsToSave) {
        const doc = new Incoming(wbData);
        await doc.save();
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
          // <<< HUGSEESTRADE INTEGRATION: Find Product ID and get Conversion Factor >>>
          const product = await Product.findOne({ productName: itemData.productName });
          if (!product) {
              console.warn(`[stockinmolino] Product "${itemData.productName}" not found during Incoming edit. Skipping item, or will have null productId.`);
              items.push({ // Still push the item, but with null productId
                productName: itemData.productName || "",
                incoming: Number(itemData.incoming) || 0,
                uomIncoming: itemData.uomIncoming || "",
                actualCount: itemData.actualCount ? Number(itemData.actualCount) : 0,
                remarkActual: itemData.remarkActual || "",
                productId: null, // Product not found
                conversionFactor: 1 // Default
              });
              continue;
          }
          // <<< END HUGSEESTRADE INTEGRATION >>>
          items.push({
            productName: itemData.productName || "",
            incoming: Number(itemData.incoming) || 0,
            uomIncoming: itemData.uomIncoming || "",
            actualCount: itemData.actualCount ? Number(itemData.actualCount) : 0,
            remarkActual: itemData.remarkActual || "",
            // <<< HUGSEESTRADE INTEGRATION: Add productId and conversionFactor >>>
            productId: product._id,
            conversionFactor: product.conversionFactor || 1
            // <<< END HUGSEESTRADE ADDITIONS >>>
          });
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
      res.redirect("/waybills");
    } catch (err) {
      console.error(err);
      res.status(500).send("Error updating waybill.");
    }
  });

  return router;
};
