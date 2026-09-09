# Запуск на Hugging Face Spaces (бесплатно, без карты) или любом Docker-хостинге
FROM node:20-slim

WORKDIR /app

# зависимости
COPY package*.json ./
RUN npm install --omit=dev

# код и данные (шаблон ЕИС + русская OCR-модель)
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY data/eis-template.xls ./data/eis-template.xls
COPY data/tessdata ./data/tessdata

# папки для загрузок (создаются при старте)
RUN mkdir -p data/uploads data/contracts

ENV NODE_ENV=production
ENV PORT=7860
EXPOSE 7860

CMD ["npm", "start"]
