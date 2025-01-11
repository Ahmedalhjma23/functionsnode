// index.js

const express = require('express');
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const winston = require('winston');

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

/**
 * دالة لجلب بيانات الرحلات من موقع اليمنية وتخزينها في قاعدة البيانات
 */
async function fetchFlightData() {
  let browser;
  try {
    logger.info('بدء تشغيل Puppeteer...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });
    logger.info('تم تشغيل Puppeteer بنجاح.');
    const page = await browser.newPage();
    logger.info('تم فتح صفحة جديدة.');
    await page.goto('https://yemenia.com/ar/flights', { waitUntil: 'networkidle2' });
    logger.info('تم الانتقال إلى موقع اليمنية.');

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

    logger.info(`تم جلب ${flights.length} رحلة من الموقع.`);

    // حفظ الرحلات في قاعدة البيانات
    for (const flight of flights) {
      try {
        // التحقق من عدم وجود الرحلة مسبقًا
        const exists = await Flight.findOne({
          flightNumber: flight.flightNumber,
          departureDate: flight.departureDate,
          departureTime: flight.departureTime
        });

        if (!exists) {
          const newFlight = new Flight(flight);
          await newFlight.save();
          logger.info(`تمت إضافة رحلة جديدة: ${flight.flightNumber}`);
        } else {
          logger.info(`الرحلة موجودة بالفعل: ${flight.flightNumber}`);
        }
      } catch (dbError) {
        logger.error(`خطأ عند حفظ الرحلة ${flight.flightNumber}: ${dbError.message}`);
      }
    }

  } catch (error) {
    logger.error(`حدث خطأ أثناء جلب البيانات: ${error.message}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
        logger.info('تم إغلاق Puppeteer.');
      } catch (closeError) {
        logger.error(`خطأ عند إغلاق Puppeteer: ${closeError.message}`);
      }
    }
  }
}

// جلب البيانات مرة عند بدء التشغيل
fetchFlightData().then(() => {
  logger.info('تم جلب البيانات الأولية.');
}).catch(error => {
  logger.error(`خطأ في جلب البيانات الأولية: ${error.message}`);
});

// إنشاء تطبيق Express
const app = express();

// تفعيل CORS للسماح بالطلبات من مصادر مختلفة
app.use(cors());

// نقطة النهاية لعرض بيانات الرحلات كـ JSON من قاعدة البيانات
app.get('/api/flights', async (req, res) => {
  try {
    const flights = await Flight.find().sort({ fetchedAt: -1 });
    if (flights.length === 0) {
      return res.status(503).json({ message: 'البيانات قيد التحميل. الرجاء المحاولة لاحقًا.' });
    }
    res.json(flights);
  } catch (error) {
    logger.error(`خطأ أثناء جلب البيانات من قاعدة البيانات: ${error.message}`);
    res.status(500).json({ message: 'حدث خطأ أثناء جلب البيانات.', error: error.message });
  }
});

// نقطة النهاية الأساسية لعرض بيانات الرحلات مباشرةً
app.get('/', async (req, res) => {
  try {
    const flights = await Flight.find().sort({ fetchedAt: -1 });
    if (flights.length === 0) {
      return res.status(503).json({ message: 'البيانات قيد التحميل. الرجاء المحاولة لاحقًا.' });
    }
    res.json(flights);
  } catch (error) {
    logger.error(`خطأ أثناء جلب البيانات من قاعدة البيانات: ${error.message}`);
    res.status(500).json({ message: 'حدث خطأ أثناء جلب البيانات.', error: error.message });
  }
});

// تحديث البيانات كل ساعة باستخدام node-cron (كل ٠ * * * * = رأس كل ساعة)
cron.schedule('0 * * * *', () => {
  logger.info('بدء تحديث البيانات (من الكرون)...');
  fetchFlightData();
});

// الاتصال بقاعدة بيانات MongoDB قبل تشغيل السيرفر
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  logger.info('تم الاتصال بقاعدة بيانات MongoDB بنجاح.');
  // تشغيل السيرفر بعد الاتصال بقاعدة البيانات
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info(`السيرفر يعمل على http://localhost:${PORT}/api/flights`);
  });
}).catch(error => {
  logger.error(`فشل الاتصال بقاعدة بيانات MongoDB: ${error.message}`);
});