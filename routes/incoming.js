// D:\stockinmolino\routes\incoming.js
const express = require("express");
const router = express.Router();
const dayjs = require("dayjs");
const mongoose = require("mongoose");

// Import models - ensure all are factory functions and use the same connection
const Incoming = require("../models/Incoming")(mongoose.connection);
const Count = require("../models/ActualCount")(mongoose.connection); // Your stockinmolino calls it Count, but we'll use the filename
const Product = require("../models/Product")(mongoose.connection); // Product now loaded as a factory function

module.exports = () => {
  // GET Incoming Count page
  router.get("/incoming/count", async (req, res) => {
    try {
      const waybills = await Incoming.find({ status: "OPEN" }).sort({ createdAt: -1 });
      res.render("incoming_count", { waybills, dayjs, currentUser: req.session.username, currentRole: req.session.role });
    } catch (err) {
      console.error("Error fetching waybills:", err);
      res.status(500).send("Server Error");
    }
  });

  // POST Save Actual Counts + Remarks (for stockinmolino's /incoming/count/save)
  router.post("/incoming/count/save", async (req, res) => {
    try {
      const { waybillId, counts, remarkActual } = req.body;
      if (!waybillId) return res.status(400).send("Waybill ID missing.");

      const waybill = await Incoming.findById(waybillId);
      if (!waybill) return res.status(404).send("Waybill not found.");

      let incomingModified = false; // Flag to check if waybill.save() is needed
      for (const item of waybill.items) {
        const rawValue = counts?.[item.productName] || "";
        const numbers = rawValue
          .split(",")
          .map((n) => parseInt(n.trim()))
          .filter((n) => !isNaN(n));
        
        if(item.actualCount !== numbers.reduce((sum, val) => sum + val, 0)) { // Check if actualCount changed
            item.actualCount = numbers.reduce((sum, val) => sum + val, 0);
            incomingModified = true;
        }
        if(item.remarkActual !== (remarkActual?.[item.productName] || "")) { // Check if remarkActual changed
            item.remarkActual = remarkActual?.[item.productName] || "";
            incomingModified = true;
        }

        // >>> HUGSEESTRADE INTEGRATION: Ensure productId and conversionFactor are present on save <<<
        if (!item.productId || !item.conversionFactor) { // Only attempt lookup if not already linked
            const product = await Product.findOne({ productName: item.productName });
            if (product) {
                item.productId = product._id;
                item.conversionFactor = product.conversionFactor || 1; // Assuming product.conversionFactor can exist in product model
                incomingModified = true;
            } else {
                console.warn(`[stockinmolino] Product "${item.productName}" not found during Incoming count save. productId/conversionFactor not set.`);
                item.productId = null; // Set explicitly to null if not found
                item.conversionFactor = 1; // Default
                incomingModified = true;
            }
        }
        // >>> END HUGSEESTRADE INTEGRATION <<<
      }

      if(incomingModified) { // Only save if the waybill was actually modified
          await waybill.save(); // This will save the updated Incoming document
          console.log(`[stockinmolino-routes/incoming.js] Waybill ${waybill.waybillNo} updated after count save.`);
          // <<< HUGSEESTRADE INTEGRATION: Trigger Webhook after save <<<
          try {
              await fetch('http://localhost:5000/api/webhooks/incoming-update', { // Adjust URL for deployment
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ incomingId: waybill._id, secret: process.env.WEBHOOK_SECRET })
              });
              console.log(`[stockinmolino-routes/incoming.js] Webhook sent for count save of Incoming ID: ${waybill._id}`);
          } catch (webhookError) {
              console.error(`[stockinmolino-routes/incoming.js] ERROR sending webhook for count save of Incoming ID ${waybill._id}:`, webhookError);
          }
          // >>> END HUGSEESTRADE INTEGRATION <<<
      }


      // Also insert into "counts" collection (our ActualCount model)
      const formattedDate = new Date(waybill.date).toLocaleDateString("en-US", {
        month: "long",
        day: "2-digit",
        year: "numeric",
      });

      for(const item of waybill.items) {
          const product = await Product.findOne({ productName: item.productName }); // Re-lookup Product for Count doc
          await Count.findOneAndUpdate(
            { waybillId: waybill._id, productName: item.productName }, // Filter by waybillId and productName
            {
              waybillId: waybill._id,
              waybillNo: waybill.waybillNo,
              count: waybill.count,
              uom: waybill.uom,
              date: formattedDate,
              productName: item.productName,
              actualCount: item.actualCount,
              remarkActual: item.remarkActual || "",
              productId: product ? product._id : null,
              savedAt: new Date(),
            },
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
        const wbData = waybillsRaw[key];
        if (!wbData.waybillNo || !wbData.count || !wbData.uom || !wbData.items)
          continue;

        // <<< ADDED: Duplicate Waybill Number Check >>>
        const existingIncoming = await Incoming.findOne({ waybillNo: wbData.waybillNo });
        if (existingIncoming) {
          console.warn(`[stockinmolino-routes/incoming.js] WARNING: Duplicate waybill number detected: ${wbData.waybillNo}`);
          return res.status(409).send(`Duplicate Waybill Number: ${wbData.waybillNo}. Please use a unique number.`);
        }
        // <<< END ADDED >>>

        const items = [];
        for (const itemData of wbData.items) {
          console.log(`[stockinmolino-routes/incoming.js] POST /incoming: Searching for Product with productName: "${itemData.productName}"`);
          const product = await Product.findOne({ productName: itemData.productName });
          
          if (!product) {
            console.warn(`[stockinmolino-routes/incoming.js] WARNING: Product "${itemData.productName}" NOT FOUND in DB. Item will be saved with null productId.`);
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
            console.log(`[stockinmolino-routes/incoming.js] Product "${itemData.productName}" FOUND (ID: ${product._id}).`);
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

        waybillsToSave.push({
          date: wbData.date ? new Date(wbData.date) : new Date(),
          waybillNo: wbData.waybillNo,
          count: Number(wbData.count),
          uom: wbData.uom,
          items,
          status: "OPEN",
        });
      }

      for (const wbData of waybillsToSave) {
        const doc = new Incoming(wbData);
        await doc.save();
        console.log(`[stockinmolino-routes/incoming.js] New Incoming document saved (ID: ${doc._id}).`);
        doc.items.forEach((item, index) => {
            console.log(`[stockinmolino-routes/incoming.js]   Item ${index}: productName: "${item.productName}", productId: ${item.productId}, conversionFactor: ${item.conversionFactor}`);
        });
        // <<< HUGSEESTRADE INTEGRATION: Trigger Webhook after save for new Waybill >>>
        try {
            await fetch('http://localhost:5000/api/webhooks/incoming-update', { // Adjust URL for deployment
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ incomingId: doc._id, secret: process.env.WEBHOOK_SECRET })
            });
            console.log(`[stockinmolino-routes/incoming.js] Webhook sent for new Incoming ID: ${doc._id}`);
        } catch (webhookError) {
            console.error(`[stockinmolino-routes/incoming.js] ERROR sending webhook for new Incoming ID ${doc._id}:`, webhookError);
        }
        // >>> END HUGSEESTRADE INTEGRATION <<<
      }

      res.redirect("/incoming/new");
    } catch (err) {
      console.error("Error saving incoming data:", err);
      res.status(500).send("Error saving incoming data.");
    }
  });


  // ... (existing routes like app.get("/waybills/close/:id")) ...

  router.post("/waybills/close/:id", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
    try {
      const waybill = await Incoming.findById(req.params.id);
      if (!waybill) return res.status(404).send("Waybill not found.");

      const oldStatus = waybill.status; // Store original status
      waybill.status = "CLOSED";
      waybill.closedAt = new Date();
      await waybill.save();
      console.log(`[stockinmolino-routes/incoming.js] Waybill ${waybill.waybillNo} (ID: ${waybill._id}) status changed from ${oldStatus} to CLOSED.`);

      // <<< HUGSEESTRADE INTEGRATION: Trigger Webhook after status change to CLOSED >>>
      try {
        await fetch('http://localhost:5000/api/webhooks/incoming-update', { // Adjust URL for deployment
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ incomingId: waybill._id, secret: process.env.WEBHOOK_SECRET })
        });
        console.log(`[stockinmolino-routes/incoming.js] Webhook sent for close of Incoming ID: ${waybill._id}`);
      } catch (webhookError) {
        console.error(`[stockinmolino-routes/incoming.js] ERROR sending webhook for close of Incoming ID ${waybill._id}:`, webhookError);
      }
      // >>> END HUGSEESTRADE INTEGRATION <<<

      res.redirect("/waybills");
    } catch (err) {
      console.error(err);
      res.status(500).send("Error closing waybill.");
    }
  });


  // POST Route for editing existing waybills
  router.post("/waybills/edit/:id", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
    try {
      const id = req.params.id;
      const wbRaw = req.body.waybills[0];
      if (!wbRaw) return res.status(400).send("No waybill data provided.");

      const items = [];
      for (const itemData of wbRaw.items) {
          console.log(`[stockinmolino-routes/incoming.js] POST /waybills/edit: Looking up Product for productName: "${itemData.productName}"`);
          const product = await Product.findOne({ productName: itemData.productName });
          if (!product) {
              console.warn(`[stockinmolino-routes/incoming.js] WARNING: Product "${itemData.productName}" NOT FOUND during Incoming edit. Item will be saved with null productId.`);
              items.push({ // Still push the item, but with null productId
                productName: itemData.productName || "",
                incoming: Number(itemData.incoming) || 0,
                uomIncoming: itemData.uomIncoming || "",
                actualCount: itemData.actualCount ? Number(itemData.actualCount) : 0,
                remarkActual: itemData.remarkActual || "",
                productId: null,
                conversionFactor: Number(itemData.conversionFactor) || 1
              });
          } else {
              console.log(`[stockinmolino-routes/incoming.js] Product "${itemData.productName}" FOUND (ID: ${product._id}).`);
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
      console.log(`[stockinmolino-routes/incoming.js] Incoming document updated (ID: ${result._id}).`);
      result.items.forEach((item, index) => {
          console.log(`[stockinmolino-routes/incoming.js]   Item ${index}: productName: "${item.productName}", productId: ${item.productId}, conversionFactor: ${item.conversionFactor}`);
      });

      // <<< HUGSEESTRADE INTEGRATION: Trigger Webhook after edit save >>>
      // Always call webhook when an incoming document is saved. HugseesTrade handles filtering.
      try {
        await fetch('http://localhost:5000/api/webhooks/incoming-update', { // Adjust URL for deployment
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ incomingId: result._id, secret: process.env.WEBHOOK_SECRET })
        });
        console.log(`[stockinmolino-routes/incoming.js] Webhook sent for edit of Incoming ID: ${result._id}`);
      } catch (webhookError) {
        console.error(`[stockinmolino-routes/incoming.js] ERROR sending webhook for edit of Incoming ID ${result._id}:`, webhookError);
      }
      // >>> END HUGSEESTRADE INTEGRATION <<<

      res.redirect("/waybills");
    } catch (err) {
      console.error("Error updating waybill:", err);
      res.status(500).send("Error updating waybill.");
    }
  });

  return router;
};