# Aura Bot Yeni - Railway Deployment Guide

Bu bot Railway üzerinde 7/24 aktif çalışacak şekilde yapılandırılmıştır.

## Kurulum Adımları

1. **Railway Hesabı:** [railway.app](https://railway.app/) üzerinden bir proje oluşturun.
2. **GitHub Bağlantısı:** Bu klasörü bir GitHub reposuna yükleyin ve Railway'e bağlayın.
3. **Variables (Değişkenler):** Railway panelinde "Variables" sekmesine gidin ve `.env` dosyasındaki tüm değerleri oraya tek tek ekleyin:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `GUILD_ID`
   - `STUDENT_ROLE_ID`
   - `COACH_ROLE_ID`
   - `MONGO_URL`
   - `MONGO_DB_NAME`
   - `CLASS_A_CHANNEL_ID` / `CLASS_B_CHANNEL_ID` / `CLASS_C_CHANNEL_ID`
   - `LOGS_CHANNEL_ID`
   - vb.

**Önemli:** `MONGO_URL` değerini eklerken tırnak işaretleri olmadan ve boşluk bırakmadan yapıştırın.

## Botu Başlatma
Railway dosyaları algıladığında `npm start` komutuyla botu otomatik olarak başlatacaktır.
