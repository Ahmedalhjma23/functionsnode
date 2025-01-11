const express = require('express');
const puppeteer = require('puppeteer'); // استخدام 'puppeteer' بدلاً من 'puppeteer-core'
const cron = require('node-cron');
const cors = require('cors');
require('dotenv').config();

// متغير لتخزين البيانات المحدثة
let flightsData = [];

/**
 * دالة لجلب بيانات الرحلات من موقع اليمنية
 */
async function fetchFlightData() {
  let browser;
  try {
    console.log('بدء تشغيل Puppeteer...');
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
      // لا حاجة لتحديد 'executablePath'، Puppeteer يتولى تنزيل Chromium تلقائيًا
    });
    console.log('تم تشغيل Puppeteer بنجاح.');
    const page = await browser.newPage();
    console.log('تم فتح صفحة جديدة.');
    await page.goto('https://yemenia.com/ar/flights', { waitUntil: 'networkidle2' });
    console.log('تم الانتقال إلى موقع اليمنية.');

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

    console.log(`تم جلب ${flights.length} رحلة من الموقع.`);

    // قارن البيانات القديمة بالبيانات الجديدة لتحديث فقط الرحلات الجديدة
    const newFlights = flights.filter((flight) => {
      return !flightsData.some(
        (existingFlight) =>
          existingFlight.flightNumber === flight.flightNumber &&
          existingFlight.departureDate === flight.departureDate &&
          existingFlight.departureTime === flight.departureTime
      );
    });

    if (newFlights.length > 0) {
      flightsData = [...flightsData, ...newFlights];
      console.log(`تمت إضافة ${newFlights.length} رحلة جديدة`);
    } else {
      console.log('لا توجد رحلات جديدة');
    }
  } catch (error) {
    console.error('حدث خطأ أثناء جلب البيانات:', error);
  } finally {
    if (browser) {
      await browser.close();
      console.log('تم إغلاق Puppeteer.');
    }
  }
}

// جلب البيانات مرة عند بدء التشغيل
fetchFlightData().then(() => {
  console.log('تم جلب البيانات الأولية.');
}).catch(error => {
  console.error('خطأ في جلب البيانات الأولية:', error);
});

// إنشاء تطبيق Express
const app = express();

// تفعيل CORS للسماح بالطلبات من مصادر مختلفة
app.use(cors());

// نقطة النهاية لعرض بيانات الرحلات كـ JSON
app.get('/api/flights', (req, res) => {
  if (flightsData.length === 0) {
    return res.status(503).json({ message: 'البيانات قيد التحميل. الرجاء المحاولة لاحقًا.' });
  }
  res.json(flightsData);
});

// نقطة النهاية الأساسية لعرض بيانات الرحلات مباشرةً
app.get('/', (req, res) => {
  if (flightsData.length === 0) {
    return res.status(503).json({ message: 'البيانات قيد التحميل. الرجاء المحاولة لاحقًا.' });
  }
  res.json(flightsData);
});

// تحديث البيانات كل ساعة باستخدام node-cron (كل ٠ * * * * = رأس كل ساعة)
cron.schedule('0 * * * *', () => {
  console.log('تحديث البيانات (من الكرون) ...');
  fetchFlightData();
});

// تشغيل السيرفر على المنفذ المحدد في المتغير البيئي أو 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`السيرفر يعمل على http://localhost:${PORT}/api/flights`);
});