const express = require('express');
const puppeteer = require('puppeteer');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const winston = require('winston');
const serverless = require('serverless-http');
const cors = require('cors');

dotenv.config();

// إعداد Winson لإدارة السجلات
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'app.log' })
  ],
});

// تعريف نموذج بيانات الرحلات باستخدام Mongoose
const flightSchema = new mongoose.Schema({
  route: { type: String, required: true },
  flightNumber: { type: String, required: true },
  status: { type: String, required: true },
  departureTime: { type: String, required: true },
  departureDate: { type: String, required: true },
  arrivalTime: { type: String, required: true },
  arrivalDate: { type: String, required: true },
  fetchedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const Flight = mongoose.model('Flight', flightSchema);

let isConnected;

async function connectDB() {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    isConnected = true;
    logger.info('تم الاتصال بقاعدة بيانات MongoDB بنجاح.');
  } catch (error) {
    logger.error(`فشل الاتصال بقاعدة بيانات MongoDB: ${error.message}`);
  }
}

/**
 * دالة لجلب بيانات الرحلات من موقع اليمنية وتخزينها في قاعدة البيانات
 */
async function fetchFlightData() {
  let browser;
  try {
    await connectDB();
    logger.info('بدء تشغيل Puppeteer...');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--single-process', '--disable-gpu']
    });

    const page = await browser.newPage();
    await page.goto('https://yemenia.com/ar/flights', { waitUntil: 'networkidle2' });

    const flights = await page.evaluate(() => {
      const allFlights = [];
      const sections = document.querySelectorAll('h3.text-primary');
      const tables = document.querySelectorAll('table.table-bordered');
      sections.forEach((section, index) => {
        const route = section.innerText.trim();
        const rows = tables[index]?.querySelectorAll('tbody tr') || [];
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          allFlights.push({
            route,
            flightNumber: cells[0]?.innerText.trim() || 'N/A',
            status: cells[1]?.innerText.trim() || 'N/A',
            departureTime: cells[2]?.querySelector('strong')?.innerText.trim() || 'N/A',
            departureDate: cells[2]?.querySelector('.small')?.innerText.trim() || 'N/A',
            arrivalTime: cells[3]?.querySelector('strong')?.innerText.trim() || 'N/A',
            arrivalDate: cells[3]?.querySelector('.small')?.innerText.trim() || 'N/A',
          });
        });
      });
      return allFlights;
    });

    // حفظ الرحلات في قاعدة البيانات
    for (const flight of flights) {
      const exists = await Flight.findOne({ flightNumber: flight.flightNumber, departureDate: flight.departureDate, departureTime: flight.departureTime });
      if (!exists) {
        const newFlight = new Flight(flight);
        await newFlight.save();
        logger.info(`تمت إضافة رحلة جديدة: ${flight.flightNumber}`);
      } else {
        logger.info(`الرحلة موجودة بالفعل: ${flight.flightNumber}`);
      }
    }
  } catch (error) {
    logger.error(`حدث خطأ أثناء جلب البيانات: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
      logger.info('تم إغلاق Puppeteer.');
    }
  }
}

// إنشاء تطبيق Express
const app = express();
app.use(cors());

// نقطة النهاية لعرض بيانات الرحلات كـ JSON
app.get('/api/flights', async (req, res) => {
  try {
    const flights = await Flight.find().sort({ fetchedAt: -1 });
    res.json(flights.length ? flights : { message: 'لا توجد بيانات متاحة.' });
  } catch (error) {
    logger.error(`خطأ أثناء جلب البيانات من قاعدة البيانات: ${error.message}`);
    res.status(500).json({ message: 'حدث خطأ أثناء جلب البيانات.', error: error.message });
  }
});

// تصدير التطبيق كدالة Serverless
module.exports.handler = serverless(app);
