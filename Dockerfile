# استخدم صورة Node.js الرسمية
FROM node:20

# تثبيت Chromium
RUN apt-get update && apt-get install -y chromium

# تعيين متغيرات البيئة لـ Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# إنشاء مجلد العمل
WORKDIR /app

# نسخ ملفات المشروع
COPY package.json package-lock.json ./
RUN npm install

# نسخ باقي الملفات
COPY . .

# تعيين منفذ التشغيل
EXPOSE 3000

# تشغيل التطبيق
CMD ["npm", "start"]