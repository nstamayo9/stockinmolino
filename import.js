// import.js
require('dotenv').config();
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const Product = require('./models/Product');

// Helper to clean Excel cell values
function parseCellValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.text) return v.text;
    if (v.result) return String(v.result);
    return String(v);
  }
  return String(v);
}

async function importFile(filePath = 'products.xlsx') {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];

    const products = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header row

      const category = parseCellValue(row.getCell(1).value);
      const productName = parseCellValue(row.getCell(2).value);

      if (category && productName) {
        products.push({
          category,
          categoryNormalized: category.toLowerCase(),
          productName,
          productNameNormalized: productName.toLowerCase(),
        });
      }
    });

    await Product.deleteMany({});
    await Product.insertMany(products);

    console.log(`✅ Imported ${products.length} products`);
  } catch (err) {
    console.error('❌ Error importing:', err);
  } finally {
    mongoose.disconnect();
  }
}

importFile();
