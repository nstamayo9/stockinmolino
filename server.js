// D:\stockinmolino\server.js
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const dayjs = require("dayjs");
const puppeteer = require("puppeteer");
const ejs = require("ejs");
const bcrypt = require('bcryptjs');
const session = require('express-session');
const MongoStore = require('connect-mongo'); // Ensure connect-mongo is installed

const app = express();

// ----------------- MONGODB CONNECTIONS -----------------
// We will use a single Mongoose connection instance for all models for consistency.
const stockMolinoConn = mongoose.createConnection(process.env.MONGO_URI, {
  dbName: "stockdb",
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 30000,
});

let isDbConnected = false; // Flag to track connection status
stockMolinoConn.once("open", () => {
  console.log("✅ MongoDB connected to stockdb (stockMolinoConn)");
  isDbConnected = true; // Set flag when connected
});
stockMolinoConn.on("error", (err) => {
  console.error("MongoDB stockdb connection error (stockMolinoConn):", err);
  process.exit(1); // Exit if critical connection error
});

// Function to wait for DB connection to be fully open before starting server
const waitForDbConnection = () => {
    return new Promise((resolve, reject) => {
        if (isDbConnected) { // Check flag if already connected
            return resolve();
        }
        stockMolinoConn.once('open', resolve); // Resolve when connection opens
        stockMolinoConn.once('error', reject); // Reject on connection error
        // Timeout for the wait itself in case it never connects
        setTimeout(() => reject(new Error('DB connection to stockMolinoConn timed out.')), 60000); 
    });
};


// ----------------- SCHEMAS / MODELS (Declared globally, assigned in promise chain) -----------------
// Declare variables here, they will be assigned their model instances AFTER DB connection
let Product, Incoming, Count, User;


// ----------------- MIDDLEWARE -----------------
app.use(express.json()); // Body parser for JSON
app.use(express.urlencoded({ extended: true })); // Body parser for form submissions
app.use(express.static(path.join(__dirname, "public"))); // Serve static files

// --- Session middleware (Uses client from stockMolinoConn, so also needs to be after connection) ---
app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecretkey', // Ensure this is a strong secret in .env
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ // Using connect-mongo for session storage
    client: stockMolinoConn.getClient(), // Client obtained from stockMolinoConn
    collectionName: 'sessions',
    ttl: 1000 * 60 * 60 * 24 // 1 day session
  }),
  cookie: { 
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
    httpOnly: true,
    sameSite: 'lax',
  }
}));

// Simple authentication check middleware
let isAuthenticated = (req, res, next) => { // Declare with let/var so it can be assigned inside then block
  if (req.session.userId) {
    next();
  } else {
    req.session.returnTo = req.originalUrl;
    req.session.message = "Please log in to access this resource.";
    res.redirect('/login');
  }
};

// Simple authorization check middleware
let authorizeRole = (requiredRoles) => { // Declare with let/var so it can be assigned inside then block
  const rolesArray = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];

  return (req, res, next) => {
    if (!req.session.userId || !req.session.role) {
      req.session.message = "You are not authenticated.";
      return res.redirect('/login');
    }

    if (rolesArray.includes(req.session.role)) {
      next();
    } else {
      console.warn(`Access Denied: User role '${req.session.role}' not in required roles [${rolesArray.join(', ')}]`);
      return res.status(403).render('access_denied', {
        currentUser: req.session.username,
        currentRole: req.session.role,
        message: "You do not have permission to access this page."
      });
    }
  };
};


// ----------------- VIEW ENGINE -----------------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));


// ----------------- START SERVER BLOCK (Includes ALL model loading and ALL route registration) -----------------
waitForDbConnection().then(() => {
    console.log("✅ All Mongoose models will be initialized now.");

    // ----------------- SCHEMAS / MODELS (LOADED HERE AFTER CONNECTION IS OPEN) -----------------
    // Assign to previously declared global variables
    const createProductModel = require("./models/Product");
    Product = createProductModel(stockMolinoConn); 

    const createIncomingModel = require("./models/Incoming");
    Incoming = createIncomingModel(stockMolinoConn);

    const createActualCountModel = require("./models/ActualCount"); // This is your Count model
    Count = createActualCountModel(stockMolinoConn);

    const createUserModel = require("./models/User");
    User = createUserModel(stockMolinoConn);
    
    console.log("✅ All Mongoose models initialized after DB connection.");


    // ----------------- LOGIN & LOGOUT (Publicly Accessible) -----------------
    app.get("/login", (req, res) => {
      res.render("login", { message: req.session.message || '' });
      req.session.message = null;
    });

    app.post("/login", async (req, res) => {
      const { username, password } = req.body;
      try {
        const user = await User.findOne({ username });
        if (!user) {
          req.session.message = "Invalid username or password.";
          return res.redirect("/login");
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
          req.session.message = "Invalid username or password.";
          return res.redirect("/login");
        }

        req.session.userId = user._id;
        req.session.username = user.username;
        req.session.role = user.role;

        const redirectTo = req.session.returnTo || "/";
        delete req.session.returnTo;
        res.redirect(redirectTo);
      } catch (err) {
        console.error("Login error:", err);
        req.session.message = "An error occurred during login.";
        res.redirect("/login");
      }
    });

    app.get("/logout", (req, res) => {
      req.session.destroy(err => {
        if (err) {
          console.error("Logout error:", err);
          return res.status(500).send("Error logging out.");
        }
        res.redirect("/login");
      });
    });

    // --- APPLY isAuthenticated TO ALL REMAINING ROUTES ---
    app.use(isAuthenticated);


    // ----------------- DASHBOARD -----------------
    app.get("/", authorizeRole(['Super Admin', 'Admin', 'User']), async (req, res) => {
      try {
        const productCount = await Product.countDocuments();
        const openWaybills = await Incoming.countDocuments({ status: "OPEN" });
        const closedWaybills = await Incoming.countDocuments({ status: "CLOSED" });
        const overdueWaybills = await Incoming.countDocuments({
          status: "OPEN",
          date: { $lt: new Date(new Date() - 7 * 24 * 60 * 60 * 1000) },
        });

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const incomingTodayAgg = await Incoming.aggregate([
          { $match: { date: { $gte: todayStart, $lte: todayEnd } } },
          { $unwind: "$items" },
          { $group: { _id: null, total: { $sum: "$items.incoming" } } },
        ]);
        const incomingToday = incomingTodayAgg[0]?.total || 0;

        const discrepanciesThisMonthCount = await Incoming.aggregate([
          { $match: { status: "CLOSED" } },
          { $unwind: "$items" },
          { $project: { diff: { $subtract: ["$items.actualCount", "$items.incoming"] } } },
          { $match: { diff: { $ne: 0 } } },
          { $count: "total" },
        ]);
        const discrepanciesThisMonth = discrepanciesThisMonthCount[0]?.total || 0;

        const startOfMonth = dayjs().startOf('month').toDate();
        const endOfMonth = dayjs().endOf('month').toDate();

        const closedWaybillsThisMonth = await Incoming.find({
            status: "CLOSED",
            closedAt: { $gte: startOfMonth, $lte: endOfMonth }
        })
        .sort({ closedAt: -1 })
        .limit(10)
        .lean();

        const discrepanciesListThisMonth = await Incoming.aggregate([
            {
                $match: {
                    status: "CLOSED",
                    closedAt: { $gte: startOfMonth, $lte: endOfMonth }
                }
            },
            { $unwind: "$items" },
            {
                $match: {
                    $expr: { $ne: ["$items.actualCount", "$items.incoming"] }
                }
            },
            {
                $project: {
                    _id: 0,
                    waybillNo: "$waybillNo",
                    productName: "$items.productName",
                    incoming: "$items.incoming",
                    actualCount: "$items.actualCount",
                    remarkActual:"$items.remarkActual",
                    closedAt: "$closedAt"
                }
            },
            { $sort: { closedAt: -1 } },
            { $limit: 10 }
        ]);


        const sparklineProductsData = [5, 10, 8, 6, 12, 9, 7];
        const sparklineWaybillsData = [2, 3, 1, 4, 3, 2, 5];
        const sparklineReportsData = [20, 15, 22, 18, 25, 12, 17];

        res.render("index", {
          productCount,
          openWaybills,
          closedWaybills,
          overdueWaybills,
          incomingToday,
          discrepanciesThisMonth,
          closedWaybillsThisMonth,
          discrepanciesListThisMonth,
          productSparklineData: JSON.stringify(sparklineProductsData),
          waybillsSparklineData: JSON.stringify(sparklineWaybillsData),
          reportsSparklineData: JSON.stringify(sparklineReportsData),
          currentUser: req.session.username,
          currentRole: req.session.role,
          dayjs: dayjs
        });
      } catch (err) {
        console.error("Error loading dashboard:", err);
        res.status(500).send("Error loading dashboard.");
      }
    });
    app.get("/index", authorizeRole(['Super Admin', 'Admin', 'User']), async (req, res) => res.redirect("/"));

    // ----------------- PRODUCT ROUTES & APIs -----------------
    app.get("/productlist", authorizeRole(['Super Admin', 'Admin']), (req, res) => res.render("productlist", { currentUser: req.session.username, currentRole: req.session.role }));
    app.get("/product/new", authorizeRole(['Super Admin', 'Admin']), (req, res) => res.render("product_new", { currentUser: req.session.username, currentRole: req.session.role }));

    app.get("/products/all", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const categoryFilter = req.query.category || '';
        const searchQuery = req.query.search || '';

        let query = {};
        if (categoryFilter) {
          query.category = new RegExp(`^${categoryFilter}$`, "i");
        }
        if (searchQuery) {
          query.productName = new RegExp(searchQuery, "i");
        }

        const products = await Product.find(query)
          .sort({ productName: 1 })
          .skip(skip)
          .limit(limit);

        const totalProducts = await Product.countDocuments(query);
        const totalPages = Math.ceil(totalProducts / limit);

        res.json({
          products,
          currentPage: page,
          totalPages,
          totalProducts,
          limit
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
      }
    });

    app.get("/categories", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const categories = await Product.distinct("category");
        res.json(categories);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
      }
    });

    app.get("/category/:category", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const category = req.params.category;
        const products = await Product.find({ category: new RegExp(`^${category}$`, "i") }).sort({ productName: 1 });
        res.json(products);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
      }
    });

    app.get("/search/:query", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const query = req.params.query;
        const products = await Product.find({ productName: new RegExp(query, "i") }).sort({ productName: 1 });
        res.json(products);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
      }
    });

    app.post("/products/add", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const { category, productName } = req.body;
        if (!category || !productName) {
          return res.status(400).json({ message: "Category and product name are required." });
        }
        const newProduct = new Product({ category, productName });
        await newProduct.save();
        res.status(201).json(newProduct);
      } catch (err) {
        console.error("Error adding product:", err);
        res.status(500).json({ message: "Error adding product.", error: err.message });
      }
    });

    app.put("/products/edit/:id", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const productId = req.params.id;
        const { category, productName } = req.body;

        if (!category || !productName) {
          return res.status(400).json({ message: "Category and product name are required." });
        }

        const updatedProduct = await Product.findByIdAndUpdate(
          productId,
          { category, productName },
          { new: true, runValidators: true }
        );

        if (!updatedProduct) {
          return res.status(404).json({ message: "Product not found." });
        }

        res.status(200).json(updatedProduct);
      } catch (err) {
        console.error("Error updating product:", err);
        if (err.name === 'ValidationError') {
            return res.status(400).json({ message: err.message });
        }
        res.status(500).json({ message: "Error updating product.", error: err.message });
      }
    });

    app.delete("/products/delete/:id", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const productId = req.params.id;
        const deletedProduct = await Product.findByIdAndDelete(productId);

        if (!deletedProduct) {
          return res.status(404).json({ message: "Product not found." });
        }

        res.status(200).json({ message: "Product deleted successfully." });
      } catch (err) {
        console.error("Error deleting product:", err);
        res.status(500).json({ message: "Error deleting product.", error: err.message });
      }
    });

    app.post("/categories/add", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
          const { category } = req.body;
          if (!category || category.trim() === '') {
              return res.status(400).json({ message: "Category name is required." });
          }
          console.log(`Received request to add category: "${category}".`);
          res.status(200).json({ message: `Category "${category}" name received. It will appear in dropdowns once a product is created with it.` });
      } catch (err) {
          console.error("Error adding category:", err);
          res.status(500).json({ message: "Error adding category.", error: err.message });
      }
    });


    // ----------------- INCOMING / WAYBILLS -----------------
    const globalUomOptions = [
      "Piece","Pair","Set","Sack / Bag","Dozen","Box","Carton","Pack","Bundle",
      "Bottle","Roll","Container","Tray","Pallet","Drum","Liter","Milliliter",
      "Kilogram","Gram","Pound","Ounce","Meter","Centimeter","Foot","Yard",
      "Square Meter","Acre","Hectare",
    ];

    app.get("/incoming/new", authorizeRole(['Super Admin', 'Admin']), (req, res) => res.render("incoming_new", {
      uomOptions: globalUomOptions,
      currentUser: req.session.username,
      currentRole: req.session.role
    }));

    app.post("/incoming", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
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
            const product = await Product.findOne({ productName: itemData.productName }); // Use stockinmolino's Product model
            if (!product) {
              console.warn(`[stockinmolino] Product "${itemData.productName}" not found during Incoming creation. Item will be saved without productId.`);
              // Assign null productId and default conversionFactor if product not found
              items.push({
                productName: itemData.productName || "",
                incoming: Number(itemData.incoming) || 0,
                uomIncoming: itemData.uomIncoming || "",
                actualCount: itemData.actualCount ? Number(itemData.actualCount) : 0,
                remarkActual: itemData.remarkActual || "",
                productId: null, // Product not found, so productId is null
                conversionFactor: Number(itemData.conversionFactor) || 1 // Use provided or default
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
            status: "OPEN",
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

    app.get("/incoming/count", authorizeRole(['Super Admin', 'Admin', 'User']), async (req, res) => {
      try {
        const waybills = await Incoming.find({ status: "OPEN" }).sort({ createdAt: -1 });
        res.render("incoming_count", { waybills, dayjs, currentUser: req.session.username, currentRole: req.session.role });
      } catch (err) {
        console.error(err);
        res.status(500).send("Error loading count page.");
      }
    });

    app.post("/incoming/count/save", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const { waybillId, counts, remarkActual } = req.body;
        if (!waybillId) return res.status(400).send("Waybill ID missing.");

        const waybill = await Incoming.findById(waybillId);
        if (!waybill) return res.status(404).send("Waybill not found.");

        for (const item of waybill.items) {
          const rawValue = counts?.[item.productName] || "";
          const numbers = rawValue.split(",").map(n => parseInt(n.trim())).filter(n => !isNaN(n));
          item.actualCount = numbers.reduce((sum, val) => sum + val, 0);
          item.remarkActual = remarkActual?.[item.productName] || "";

          await Count.findOneAndUpdate(
            { waybillId, productName: item.productName },
            {
              waybillId,
              productName: item.productName,
              counts: numbers,
              total: item.actualCount,
              remarkActual: item.remarkActual,
              savedAt: new Date(),
            },
            { upsert: true, new: true }
          );
        }

        await waybill.save();
        res.redirect("/incoming/report");
      } catch (err) {
        console.error(err);
        res.status(500).send("Error saving actual counts.");
      }
    });

    // ----------------- REPORTS -----------------
    app.get("/incoming/report", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const waybills = await Incoming.find({ status: { $in: ["OPEN", null] } }).sort({ createdAt: -1 });
        res.render("incoming_report", { waybills, dayjs, currentUser: req.session.username, currentRole: req.session.role });
      } catch (err) {
        console.error(err);
        res.status(500).send("Error loading report page.");
      }
    });

    app.get("/incoming/report/closed", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const { from, to } = req.query;
        const filter = { status: "CLOSED" };

        if (from || to) {
          filter.closedAt = {};
          if (from) {
            const fromDate = new Date(from);
            fromDate.setHours(0, 0, 0, 0);
            filter.closedAt.$gte = fromDate;
          }
          if (to) {
            const toDate = new Date(to);
            toDate.setHours(23, 59, 59, 999);
            filter.closedAt.$lte = toDate;
          }
        }

        const waybills = await Incoming.find(filter).sort({ closedAt: -1 });

        res.render("incoming_report_closed", { waybills, dayjs, from: from || "", to: to || "", currentUser: req.session.username, currentRole: req.session.role });
      } catch (err) {
        console.error(err);
        res.status(500).send("Error loading closed report page.");
      }
    });

    app.get("/incoming/report/closed/pdf", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      const { from, to } = req.query;

      try {
        const filter = { status: "CLOSED" };
        if (from || to) {
          filter.closedAt = {};
          if (from) filter.closedAt.$gte = new Date(new Date(from).setHours(0,0,0,0));
          if (to) filter.closedAt.$lte = new Date(new Date(to).setHours(23,59,59,999));
        }
        const waybills = await Incoming.find(filter).sort({ closedAt: -1 }).lean();

        const html = await ejs.renderFile(
          path.join(__dirname, "views", "incoming_closed_report_pdf.ejs"),
          { waybills, from, to, dayjs }
        );

        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
        });

        await browser.close();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="Closed_Incoming_Report.pdf"');
        res.send(pdfBuffer);
      } catch (err) {
        console.error(err);
        res.status(500).send("Error generating PDF");
      }
    });

    // ----------------- WAYBILLS -----------------
    app.get("/waybills", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const waybills = await Incoming.find({ status: { $in: ["OPEN", null] } }).sort({ createdAt: -1 });
        res.render("waybills", { waybills, dayjs, currentUser: req.session.username, currentRole: req.session.role });
      } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching waybills for display.");
      }
    });

    app.get("/waybills/closed", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const waybills = await Incoming.find({ status: "CLOSED" }).sort({ closedAt: -1 });
        res.render("closed_waybills", { waybills, dayjs, currentUser: req.session.username, currentRole: req.session.role });
      } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching closed waybills for display.");
      }
    });

    app.post("/waybills/delete/:id", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const result = await Incoming.findByIdAndDelete(req.params.id);
        if (!result) return res.status(404).send("Waybill not found.");
        res.redirect("/waybills");
      } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting waybill.");
      }
    });

    app.post("/waybills/close/:id", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const waybill = await Incoming.findById(req.params.id);
        if (!waybill) return res.status(404).send("Waybill not found.");

        waybill.status = "CLOSED";
        waybill.closedAt = new Date();
        await waybill.save();

        res.redirect("/waybills");
      } catch (err) {
        console.error(err);
        res.status(500).send("Error closing waybill.");
      }
    });

    app.get("/waybills/edit/:id", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const waybill = await Incoming.findById(req.params.id);
        if (!waybill) return res.status(404).send("Waybill not found.");
        res.render("incoming_edit", { waybill, uomOptions: globalUomOptions, currentUser: req.session.username, currentRole: req.session.role });
      } catch (err) {
        console.error("Error loading waybill for edit:", err);
        res.status(500).send("Error loading waybill for edit.");
      }
    });

    app.post("/waybills/edit/:id", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const id = req.params.id;
        const wbRaw = req.body.waybills[0];
        if (!wbRaw) return res.status(400).send("No waybill data provided.");

        const items = wbRaw.items.map(item => ({
          productName: item.productName || "",
          incoming: Number(item.incoming) || 0,
          uomIncoming: item.uomIncoming || "",
          actualCount: item.actualCount ? Number(item.actualCount) : 0,
          remarkActual: item.remarkActual || "",
        }));

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
        console.error("Error updating waybill:", err);
        res.status(500).send("Error updating waybill.");
      }
    });


    // ----------------- USER MANAGEMENT ROUTES (ONLY ADMIN) -----------------

    // Add User Page (GET)
    app.get("/User/add", authorizeRole(['Super Admin', 'Admin']), (req, res) => {
      res.render("user_add", {
        error: null,
        success: req.query.success || null,
        formData: {},
        currentUser: req.session.username,
        currentRole: req.session.role
      });
    });

    // Add User (POST)
    app.post("/User/add", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      const { username, fullname, email, password, role } = req.body;

      // Server-side check to prevent Admin from creating Super Admin
      if (req.session.role === 'Admin' && role === 'Super Admin') {
        return res.status(403).render("user_add", {
          error: "Admin users cannot create Super Admin accounts.",
          formData: req.body,
          currentUser: req.session.username,
          currentRole: req.session.role
        });
      }

      try {
        const newUser = new User({ username, fullname, email, password, role });
        await newUser.save();
        res.redirect("/User/add?success=true");
      } catch (err) {
        console.error("Error saving new user:", err);

        let errorMessage = "Error adding user.";
        if (err.code === 11000) {
          if (err.keyPattern && err.keyPattern.username) errorMessage = "Username already exists.";
          else if (err.keyPattern && err.keyPattern.email) errorMessage = "Email already exists.";
          else errorMessage = "Duplicate key error.";
        } else if (err.name === 'ValidationError') {
          const errors = Object.values(err.errors).map(val => val.message);
          errorMessage = errors.join('; ');
        } else {
          errorMessage = err.message;
        }

        res.render("user_add", {
          error: errorMessage,
          formData: req.body,
          currentUser: req.session.username,
          currentRole: req.session.role
        });
      }
    });

    // User List Page (GET)
    app.get("/User/list", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const users = await User.find().select('-password');
        res.render("user_list", {
          users,
          dayjs,
          currentUser: req.session.username,
          currentRole: req.session.role
        });
      } catch (err) {
        console.error("Error fetching users:", err);
        res.status(500).send("Error fetching user list.");
      }
    });

    app.get("/User/edit/:id", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      try {
        const user = await User.findById(req.params.id).select('-password');
        if (!user) {
          return res.status(404).send("User not found.");
        }
        res.render("user_edit", {
          user,
          error: null,
          success: req.query.success || null,
          currentUser: req.session.username,
          currentRole: req.session.role,
          formData: user.toObject()
        });
      } catch (err) {
        console.error("Error loading user for edit:", err);
        res.status(500).send("Error loading user for edit.");
      }
    });

    app.post("/User/edit/:id", authorizeRole(['Super Admin', 'Admin']), async (req, res) => {
      const userId = req.params.id;
      const { username, fullname, email, role, password } = req.body;

      // Server-side check to prevent Admin from assigning Super Admin
      if (req.session.role === 'Admin' && role === 'Super Admin') {
        const user = await User.findById(userId).select('-password');
        return res.status(403).render("user_edit", {
          user: { ...user.toObject(), ...req.body },
          error: "Admin users cannot assign the Super Admin role.",
          currentUser: req.session.username,
          currentRole: req.session.role,
          formData: { ...user.toObject(), ...req.body }
        });
      }

      try {
        const updateData = { username, fullname, email, role };

        if (password && password.trim() !== '') {
          const salt = await bcrypt.genSalt(10);
          updateData.password = await bcrypt.hash(password, salt);
        }

        const updatedUser = await User.findByIdAndUpdate(
          userId,
          updateData,
          { new: true, runValidators: true }
        );

        if (!updatedUser) {
          return res.status(404).send("User not found.");
        }

        res.redirect(`/User/list?success=updated`);
      } catch (err) {
        console.error("Error updating user:", err);

        let errorMessage = "Error updating user.";
        if (err.code === 11000) {
          if (err.keyPattern && err.keyPattern.username) errorMessage = "Username already exists.";
          else if (err.keyPattern && err.keyPattern.email) errorMessage = "Email already exists.";
          else errorMessage = "Duplicate key error.";
        } else if (err.name === 'ValidationError') {
          const errors = Object.values(err.errors).map(val => val.message);
          errorMessage = errors.join('; ');
        } else {
          errorMessage = err.message;
        }

          const user = await User.findById(userId).select('-password');
        res.render("user_edit", {
          user: { ...user.toObject(), ...req.body },
          error: errorMessage,
          currentUser: req.session.username,
          currentRole: req.session.role,
          formData: { ...user.toObject(), ...req.body }
        });
      }
    });

    app.post("/User/delete/:id", authorizeRole(['Super Admin']), async (req, res) => {
      try {
        const userIdToDelete = req.params.id;
        // Prevent a Super Admin from deleting themselves
        if (req.session.userId.toString() === userIdToDelete.toString()) {
          return res.status(403).send("Forbidden: You cannot delete your own account.");
        }

        const result = await User.findByIdAndDelete(userIdToDelete);
        if (!result) {
          return res.status(404).send("User not found.");
        }
        res.redirect("/User/list");
      } catch (err) {
        console.error("Error deleting user:", err);
        res.status(500).send("Error deleting user.");
      }
    });

    // ----------------- START SERVER -----------------
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  }).catch(err => {
    console.error("Failed to connect to database before starting server:", err);
    process.exit(1);
  });
