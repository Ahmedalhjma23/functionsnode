const express = require('express');
const puppeteer = require('puppeteer');
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
    browser = await puppeteer.launch({
    
      args: [
        
        "--disable-setuid-sandbox",
        "--no-sandbox",
        "--single-process",
        "--no-zygote",


      ],

      executablePath:
      process.env.NODE_ENV === "production"
        ? process.env.PUPPETEER_EXECUTABLE_PATH
        : puppeteer.executablePath(),
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
    console.error('حدث خطأ أثناء جلب البيانات:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// جلب البيانات مرة عند بدء التشغيل
fetchFlightData();

// إنشاء تطبيق Express
const app = express();

// تفعيل CORS للسماح بالطلبات من مصادر مختلفة
app.use(cors());

// نقطة النهاية لعرض بيانات الرحلات كـ JSON
app.get('/api/flights', (req, res) => {
  res.json(flightsData);
});

// نقطة النهاية الأساسية للتحقق من حالة السيرفر
app.get('/', (req, res) => {
  res.send('خادم تتبع الرحلات يعمل بنجاح.');
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