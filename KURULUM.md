# AURA Coaching Discord Bot — Kurulum & Deploy Rehberi

## 📋 İçindekiler
1. [Discord Bot Oluşturma](#1-discord-bot-oluşturma)
2. [Discord Sunucu Hazırlığı](#2-discord-sunucu-hazırlığı)
3. [Railway Deploy](#3-railway-deploy)
4. [Environment Variables](#4-environment-variables)
5. [Veritabanı Kurulumu](#5-veritabanı-kurulumu)
6. [Test & Kontrol](#6-test--kontrol)
7. [Sorun Giderme](#7-sorun-giderme)

---

## 1. Discord Bot Oluşturma

### 1a. Developer Portal'da Uygulama Oluştur

1. **https://discord.com/developers/applications** adresine git
2. **"New Application"** butonuna tıkla
3. İsim: `AURA Coaching Bot`
4. **General Information** sekmesinden `Application ID`'yi kopyala → bu senin `CLIENT_ID`'n

### 1b. Bot Oluştur

1. Sol menüden **"Bot"** sekmesine tıkla
2. **"Add Bot"** butonuna tıkla → onay ver
3. **"Reset Token"** butonuna tıkla → token'ı kopyala → `.env`'e `DISCORD_TOKEN` olarak ekle
4. Aşağıdaki ayarları **AÇIK** yap:
   - ✅ **PUBLIC BOT** → KAPALI yap (sadece kendi sunucunda olsun)
   - ✅ **SERVER MEMBERS INTENT**
   - ✅ **MESSAGE CONTENT INTENT**
   - ✅ **PRESENCE INTENT**

### 1c. Botu Sunucuya Ekle

1. Sol menüden **"OAuth2"** → **"URL Generator"**
2. **Scopes** seç: `bot`, `applications.commands`
3. **Bot Permissions** seç:
   - ✅ Manage Roles
   - ✅ Send Messages
   - ✅ Embed Links
   - ✅ Read Message History
   - ✅ View Channels
   - ✅ Connect (Ses kanalları için)
   - ✅ View Voice Channel Members (Ses kanalı üyeleri için)
4. Oluşan URL'yi kopyala → tarayıcıda aç → sunucunu seç → **Yetkilendir**

---

## 2. Discord Sunucu Hazırlığı

### 2a. Rolleri Oluştur

Sunucuda şu rolleri oluştur (sıra önemli — bot rolü en üstte olmalı):

| Rol Adı | Renk | Açıklama |
|---------|------|----------|
| `🎓 Koç` | İndigo | Koçlara verilecek rol |
| `👤 Öğrenci` | Pembe | Kayıtlı öğrencilere otomatik verilir |
| `🛡️ Admin` | Kırmızı | Yöneticiler |

> ⚠️ **Bot rolünün** sunucu rol listesinde `Koç` ve `Öğrenci` rollerinin **üzerinde** olması şart!
> Aksi halde bot role veremez.

Her rolün ID'sini al: **Sunucu Ayarları → Roller → Role sağ tıkla → "ID Kopyala"**

### 2b. Ses Kanallarını Oluştur

Şu yapıyı oluştur:

```
📁 COACHING SESSIONS
  🔊 VOD 1
  🔊 VOD 2
  🔊 VOD 3
  🔊 Gamesense 1
  🔊 Gamesense 2
  🔊 Gamesense 3
  🔊 Movement 1
  🔊 Movement 2
  🔊 Movement 3
  🔊 Aim 1
  🔊 Aim 2
  🔊 Aim 3
```

> ⚠️ Kanal isimlerinin içinde `VOD`, `GAMESENSE`, `MOVEMENT` veya `AIM` geçmesi şart.
> Büyük/küçük harf fark etmez.

### 2c. Log Kanallarını Oluştur

```
📁 BOT LOGS
  📝 #kayit-log
  📚 #ders-log
```

Her iki kanalın ID'sini al: **Kanala sağ tıkla → "ID Kopyala"**

### 2d. Sunucu ID'sini Al

Sunucu simgesine sağ tıkla → **"Sunucu ID'sini Kopyala"**
(Geliştirici Modu açık olmalı: Kullanıcı Ayarları → Gelişmiş → Geliştirici Modu ✅)

---

## 3. Railway Deploy

### 3a. GitHub'a Push

```bash
# Proje klasöründe:
git init
git add .
git commit -m "Initial commit - AURA Coaching Bot v2"
git remote add origin https://github.com/KULLANICI/aura-bot.git
git push -u origin main
```

### 3b. Railway'de Proje Oluştur

1. **https://railway.app** → Giriş yap
2. **"New Project"** → **"Deploy from GitHub repo"**
3. `aura-bot` reposunu seç
4. Railway otomatik deploy eder

### 3c. PostgreSQL Ekle

1. Railway projesinde **"+ New"** → **"Database"** → **"Add PostgreSQL"**
2. PostgreSQL servisine tıkla → **"Connect"** sekmesi → `DATABASE_URL`'yi kopyala

---

## 4. Environment Variables

Railway'de Bot servisine tıkla → **"Variables"** sekmesi → aşağıdakileri ekle:

```
DISCORD_TOKEN        = (Discord Developer Portal'dan aldığın bot token)
CLIENT_ID            = (Application ID)
GUILD_ID             = (Discord sunucu ID'si)
DATABASE_URL         = (Railway PostgreSQL bağlantı URL'si)

STUDENT_ROLE_ID      = (Öğrenci rolü ID'si)
COACH_ROLE_ID        = (Koç rolü ID'si)
ADMIN_ROLE_ID        = (Admin rolü ID'si)

REGISTER_LOG_CHANNEL_ID = (#kayit-log kanal ID'si)
LESSON_LOG_CHANNEL_ID   = (#ders-log kanal ID'si)

NODE_ENV             = production
```

---

## 5. Veritabanı Kurulumu

Railway deploy sırasında `railway.json`'daki start komutu otomatik çalışır:
```
npx prisma generate && npx prisma db push && node src/index.js
```

Bu komut tüm tabloları otomatik oluşturur. Manuel yapmak istersen:

```bash
# Lokal geliştirme için:
npm install
cp .env.example .env
# .env'i doldur
npx prisma db push
npm run dev
```

---

## 6. Test & Kontrol

### Bot Online mi?
Railway → Bot servisi → **"Logs"** sekmesini aç.
Şunu görmelisin:
```
[BOT] Logged in as AURA Coaching Bot#1234
[BOT] Slash commands registered successfully.
[AUTO-REG] Loop started (60s interval)
```

### Komutları Test Et

Discord sunucunda:
```
/yardim          → Komut listesi görünmeli
/ogrenci-listesi → "Kayıtlı öğrenci bulunamadı" dönmeli (henüz yok)
/kayit @kullanici Ad Soyad → Test kaydı yap
```

### Ses Kanalı Testi
1. Bir koç ve bir öğrenci aynı ses kanalına gir (VOD 1 gibi)
2. #ders-log kanalını izle
3. Kanaldan çıkılınca ders logu gelmeli (en az 5 dakika olmalı)

---

## 7. Sorun Giderme

### Bot komutlarını göremiyorum
- `GUILD_ID` doğru mu kontrol et
- Bot'u sunucudan çıkar, tekrar ekle
- Railway loglarında `commands registered` yazıyor mu bak

### Bot role veremiyor
- Bot rolü sunucu rol listesinde `Öğrenci` ve `Koç` rollerinin üzerinde mi?
- Bot'un **Manage Roles** yetkisi var mı?

### Ses kanalı izlenmiyor
- Bot `SERVER MEMBERS INTENT` açık mı?
- Kanal isimleri `VOD`, `GAMESENSE`, `MOVEMENT`, `AIM` içeriyor mu?
- Bot'un ses kanallarını görme yetkisi var mı?

### AutoRegister çalışmıyor
- Admin panelinden `AutoRegisterQueue`'ya kayıt eklenmiş mi? (processed: false)
- Öğrencinin Discord username'i doğru girilmiş mi?
- Railway loglarında `[AUTO-REG]` satırlarını kontrol et

### Database bağlantı hatası
- `DATABASE_URL` doğru kopyalanmış mı?
- Railway'de PostgreSQL servisi çalışıyor mu?

---

## 📞 Hızlı Referans

| Komut | Açıklama | Yetki |
|-------|----------|-------|
| `/yardim` | Komut listesi | Herkes |
| `/ogrenci` | Öğrenci bilgileri | Herkes |
| `/ders-raporu` | Ders geçmişi | Herkes |
| `/kayit` | Manuel kayıt | Koç/Admin |
| `/ogrenci-duzenle` | Bilgi güncelle | Koç/Admin |
| `/ogrenci-listesi` | Tüm öğrenciler | Koç/Admin |
| `/ders-ekle` | Manuel ders ekle | Koç/Admin |
| `/ders-sil` | Ders sil | Koç/Admin |
| `/koc-istatistik` | Koç istatistikleri | Koç/Admin |
| `/tum-raporlar` | Genel rapor | Koç/Admin |

---

*AURA Coaching Bot v2.0 — Built with Discord.js v14 + Prisma + PostgreSQL*
