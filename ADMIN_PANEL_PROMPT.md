# AURA Coaching Admin Paneli — Discord Bot Entegrasyonu
## AI Geliştirici Prompt'u

---

## GENEL BAĞLAM

Mevcut bir AURA Coaching admin paneli var (Next.js / React tabanlı, Tailwind CSS ile stillendirilmiş, mor/pembe gradyan tema). Bu panele yeni bir Discord botu entegre edilecek. Eski bot kaldırılıyor, yeni bot ekleniyor. Aşağıda yapılması gereken **tüm değişiklikler** detaylıca açıklanmıştır.

Veritabanı: **PostgreSQL + Prisma ORM**
Bot ile iletişim: **Shared PostgreSQL database** (bot ve admin paneli aynı DB'yi kullanıyor, direkt API çağrısı yok)

---

## 1. VERİTABANI ŞEMASI GÜNCELLEMESİ

Mevcut Prisma şemasına aşağıdaki modelleri **ekle** (mevcut modellere dokunma):

```prisma
model Student {
  id               String   @id @default(cuid())
  discordId        String   @unique
  discordUsername  String?
  name             String
  surname          String
  age              Int?
  country          String?
  rank             String?
  targetRank       String?
  trackerLink      String?
  expectations     String?
  introduction     String?
  availability     String?
  isActive         Boolean  @default(true)
  totalLessons     Int      @default(0)
  remainingLessons Int      @default(0)
  packageType      String?
  registeredAt     DateTime @default(now())
  updatedAt        DateTime @updatedAt
  lessons          Lesson[]

  @@map("students")
}

model Lesson {
  id            String   @id @default(cuid())
  lessonNumber  Int
  studentId     String
  student       Student  @relation(fields: [studentId], references: [id])
  coachId       String
  coachUsername String?
  category      String   // VOD | GAMESENSE | MOVEMENT | AIM
  channelName   String?
  startedAt     DateTime
  endedAt       DateTime?
  durationMins  Int?
  notes         String?
  isAutomatic   Boolean  @default(true)
  createdAt     DateTime @default(now())

  @@map("lessons")
}

model Coach {
  id              String   @id @default(cuid())
  discordId       String   @unique
  discordUsername String?
  name            String?
  isActive        Boolean  @default(true)
  totalLessons    Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("coaches")
}

model VoiceSession {
  id          String    @id @default(cuid())
  studentId   String
  coachId     String
  channelId   String
  channelName String?
  category    String
  joinedAt    DateTime  @default(now())
  leftAt      DateTime?
  isActive    Boolean   @default(true)

  @@map("voice_sessions")
}

model AutoRegisterQueue {
  id          String    @id @default(cuid())
  name        String
  surname     String
  discordTag  String?
  discordId   String?
  packageType String?
  rank        String?
  targetRank  String?
  createdAt   DateTime  @default(now())
  processed   Boolean   @default(false)
  processedAt DateTime?

  @@map("auto_register_queue")
}
```

---

## 2. YENİ SAYFALAR VE ROUTE'LAR

### 2a. `/dashboard/discord` — Ana Discord Yönetim Sayfası

**Tasarım:** Mevcut admin panel temasıyla uyumlu (mor/pembe gradyan, koyu arka plan, cam efekti kartlar).

**İçerik:**
- Üstte bot durumu kartı (bot online/offline göstergesi — DB'de son 2 dakikada güncellenen bir `bot_heartbeat` tablosundan çek)
- 4 istatistik kartı yan yana:
  - Toplam Kayıtlı Öğrenci sayısı
  - Bu Ay Tamamlanan Ders sayısı
  - Aktif Ses Oturumu sayısı (voice_sessions tablosundan isActive=true)
  - Dersi Bitmek Üzere Olanlar (remainingLessons ≤ 3)
- Altında 2 sütun:
  - Sol: Son 10 otomatik kayıt (auto_register_queue tablosundan)
  - Sağ: Son 10 tamamlanan ders (lessons tablosundan)

---

### 2b. `/dashboard/discord/ogrenciler` — Öğrenci Yönetimi

**Tablo kolonları:**
| # | Ad Soyad | Discord | Rank | Hedef | Paket | Tamamlanan | Kalan | Durum | İşlemler |

**Özellikler:**
- Arama (ad/soyad/discord username ile)
- Filtre: Aktif / Pasif / Dersi Bitmek Üzere
- Sıralama: Kayıt tarihi, ad, kalan ders
- Her satırda:
  - 👁️ Detay butonu → öğrenci detay modal/sayfası
  - ✏️ Düzenle butonu → düzenleme modal'ı
  - 🗑️ Sil butonu (onay dialogu ile)
- Sağ üstte "➕ Yeni Öğrenci Ekle" butonu → `AutoRegisterQueue`'ya ekler (bot otomatik işler)
- Pagination (sayfa başı 20 öğrenci)

**Öğrenci Detay Modal'ı içeriği:**
- Profil fotoğrafı (Discord avatar URL'i: `https://cdn.discordapp.com/avatars/{discordId}/{avatarHash}.png`)
- Tüm öğrenci bilgileri
- İlerleme çubuğu (tamamlanan/toplam ders)
- Son 10 ders geçmişi tablosu
- Kategori bazlı ders dağılımı (pie chart veya bar chart — recharts kullan)

**Öğrenci Ekleme Formu alanları:**
```
Ad*          Soyad*
Discord Tag  (opsiyonel, format: username veya username#0000)
Discord ID   (opsiyonel, daha güvenilir eşleşme için)
Rank         Hedef Rank
Paket        (text input, örn: "10 Ders")
Notlar
```
Form submit edilince → `AutoRegisterQueue` tablosuna insert yapılır. Bot 60 saniye içinde bunu işler ve Discord sunucusunda öğrenciyi bulup kaydeder.

---

### 2c. `/dashboard/discord/dersler` — Ders Yönetimi

**Tablo kolonları:**
| # | Ders No | Öğrenci | Koç | Kategori | Süre | Tarih | Tip | İşlemler |

**Özellikler:**
- Filtre: Kategori (VOD/Gamesense/Movement/Aim), Tarih aralığı, Öğrenci, Koç, Otomatik/Manuel
- Arama: Öğrenci adı veya Discord username
- İstatistik banner (o sayfanın üstünde):
  - Bu ayki toplam ders sayısı
  - Toplam süre (saat cinsinden)
  - En aktif kategori
  - En aktif koç
- Ders Ekleme butonu → Modal form:
  ```
  Öğrenci*      (dropdown, kayıtlı öğrenciler)
  Koç*          (dropdown, kayıtlı koçlar)
  Kategori*     (VOD / GAMESENSE / MOVEMENT / AIM)
  Süre (dk)     Notlar
  Tarih         (varsayılan: bugün)
  ```
- Ders silme (onay dialogu)
- Export butonu → CSV olarak indir (tüm filtrelenmiş dersler)

---

### 2d. `/dashboard/discord/koçlar` — Koç Yönetimi

**Tablo kolonları:**
| # | Ad | Discord | Toplam Ders | Bu Ay | Öğrenci Sayısı | Durum | İşlemler |

**Özellikler:**
- Koç ekleme formu:
  ```
  Discord ID*   Discord Username
  Ad
  ```
- Koç detay: Hangi öğrencilere ders vermiş, kategori dağılımı, aylık trend chart

---

### 2e. `/dashboard/discord/raporlar` — Raporlar & İstatistikler

**Dashboard benzeri istatistik sayfası:**

**Üst kısım — Filtre Paneli:**
- Tarih aralığı seçici (bu hafta / bu ay / bu yıl / özel aralık)

**Kartlar (2x2 grid):**
1. Toplam Ders (seçilen periyotta)
2. Toplam Süre (saat)
3. Aktif Öğrenci Sayısı
4. Ortalama Ders Süresi

**Grafikler (recharts kullan):**
1. **Aylık Ders Trendi** — Line chart, son 6 ay, her ay için ders sayısı
2. **Kategori Dağılımı** — Pie chart (VOD / Gamesense / Movement / Aim)
3. **Koç Performansı** — Bar chart, her koç için ders sayısı
4. **Haftanın Günlerine Göre Dağılım** — Bar chart (Pzt–Paz)

**Alt kısım — Tablolar:**
- En çok ders alan öğrenciler (top 10)
- En aktif koçlar (top 10)
- Dersi bitmek üzere olan öğrenciler (remainingLessons ≤ 3) — kırmızı badge ile vurgula

---

## 3. MEVCUT SAYFALARA EKLENECEK DEĞIŞIKLIKLER

### 3a. Öğrenci Formuna Discord Alanları Ekle

Mevcut "Yeni Öğrenci Ekle" formuna şu alanları ekle:
```
Discord ID        (text, opsiyonel)
Discord Username  (text, opsiyonel, @olmadan)
Paket Türü        (text, örn: "10 Ders")
Kalan Ders Sayısı (number)
```

Form kaydedildiğinde → hem mevcut tabloya kaydet, hem `AutoRegisterQueue`'ya ekle (eğer discordId veya discordTag verilmişse).

### 3b. Öğrenci Detay Sayfasına Discord Tab'ı Ekle

Mevcut öğrenci detay sayfasında yeni bir "Discord" tab'ı:
- Discord profil bilgileri
- Ders geçmişi tablosu (lessons tablosundan)
- İlerleme göstergesi

### 3c. Sidebar/Navigasyon'a Discord Bölümü Ekle

```
🤖 Discord
  ├── 📊 Genel Bakış    (/dashboard/discord)
  ├── 👥 Öğrenciler     (/dashboard/discord/ogrenciler)
  ├── 📚 Dersler        (/dashboard/discord/dersler)
  ├── 🎓 Koçlar         (/dashboard/discord/koclar)
  └── 📈 Raporlar       (/dashboard/discord/raporlar)
```

---

## 4. API ROUTE'LARI (Next.js API Routes)

Aşağıdaki endpoint'leri oluştur:

### Öğrenciler
```
GET    /api/discord/students          → Tüm öğrenciler (filtre, sayfalama)
POST   /api/discord/students          → Yeni öğrenci ekle (AutoRegisterQueue'ya da ekler)
GET    /api/discord/students/:id      → Tek öğrenci detay
PUT    /api/discord/students/:id      → Güncelle
DELETE /api/discord/students/:id      → Sil
GET    /api/discord/students/:id/lessons → Öğrencinin dersleri
```

### Dersler
```
GET    /api/discord/lessons           → Tüm dersler (filtre, sayfalama)
POST   /api/discord/lessons           → Manuel ders ekle
DELETE /api/discord/lessons/:id       → Ders sil
GET    /api/discord/lessons/export    → CSV export
```

### Koçlar
```
GET    /api/discord/coaches           → Tüm koçlar
POST   /api/discord/coaches           → Koç ekle
PUT    /api/discord/coaches/:id       → Güncelle
DELETE /api/discord/coaches/:id       → Sil
GET    /api/discord/coaches/:id/stats → Koç istatistikleri
```

### Raporlar
```
GET    /api/discord/reports/summary   → Genel özet (tarih filtresi ile)
GET    /api/discord/reports/trend     → Aylık trend verisi
GET    /api/discord/reports/category  → Kategori dağılımı
GET    /api/discord/reports/coaches   → Koç performans raporu
```

### Bot
```
GET    /api/discord/bot/status        → Bot heartbeat kontrolü
POST   /api/discord/bot/heartbeat     → Bot tarafından çağrılır (her 60sn)
GET    /api/discord/queue             → AutoRegisterQueue listesi
```

---

## 5. BOT HEARTBEAT (Bot Sağlık Kontrolü)

Bot'un online olup olmadığını görmek için:

**Prisma şemasına ekle:**
```prisma
model BotHeartbeat {
  id        String   @id @default("singleton")
  lastSeen  DateTime @default(now())
  status    String   @default("online")

  @@map("bot_heartbeat")
}
```

**Bot tarafında** (60 saniyede bir çağrılır):
```javascript
// src/utils/heartbeat.js
async function sendHeartbeat() {
  await prisma.botHeartbeat.upsert({
    where: { id: 'singleton' },
    update: { lastSeen: new Date(), status: 'online' },
    create: { id: 'singleton', lastSeen: new Date(), status: 'online' },
  });
}
setInterval(sendHeartbeat, 60_000);
```

**Admin panelinde** `lastSeen` 2 dakikadan eskiyse → "Offline" göster, kırmızı badge. Değilse → "Online", yeşil badge.

---

## 6. TASARIM GEREKSİNİMLERİ

Mevcut admin paneli temayla %100 tutarlı ol:
- **Renkler:** `#6366f1` (indigo), `#ec4899` (pembe), arka plan koyu (`#0f0f1a` civarı)
- **Kartlar:** `backdrop-blur`, `bg-white/5` veya `bg-white/10`, `border border-white/10`
- **Butonlar:** Gradient (`from-indigo-500 to-pink-500`)
- **Tablolar:** Koyu arka plan, hover efekti, zebra satır yok
- **Badge'ler:**
  - Aktif → yeşil (`bg-green-500/20 text-green-400`)
  - Pasif → gri (`bg-gray-500/20 text-gray-400`)
  - Uyarı → sarı (`bg-yellow-500/20 text-yellow-400`)
  - Hata → kırmızı (`bg-red-500/20 text-red-400`)
- **Kategori renkleri:**
  - VOD → indigo (`#6366f1`)
  - Gamesense → pembe (`#ec4899`)
  - Movement → yeşil (`#22c55e`)
  - Aim → turuncu (`#f59e0b`)

---

## 7. KALDIRILAN ESKİ BOT

Eski Discord bota ait olan her şeyi kaldır:
- Eski bot token environment variable
- Eski bot entegrasyon kodları ve servisler
- Eski bot'a ait veritabanı tabloları (varsa) — ama önce backup al
- Eski bot'a ait sidebar/navigasyon linkleri

Yeni bot için environment variable:
```env
DISCORD_BOT_TOKEN=...      # Sadece gösterge amaçlı, bot direkt DB kullanıyor
```

---

## 8. ENVIRONMENT VARIABLES (Admin Paneli)

```env
# Mevcut değişkenlere ek olarak:
DATABASE_URL=...            # Zaten var, bot ile aynı DB
DISCORD_GUILD_ID=...        # Sunucu ID (gösterim amaçlı)
DISCORD_CLIENT_ID=...       # Bot client ID (gösterim amaçlı)
```

---

## 9. KURULUM NOTLARI

Admin paneli deploy edildiğinde:
```bash
npx prisma migrate dev --name add_discord_tables
# veya
npx prisma db push
```

Bu komut yeni tabloları (students, lessons, coaches, voice_sessions, auto_register_queue, bot_heartbeat) oluşturur.

---

## 10. ÖNEMLİ NOTLAR

1. **Ortak Database:** Bot ve admin paneli **aynı PostgreSQL veritabanını** kullanır. Direkt HTTP iletişim yok. Admin paneli DB'ye yazar, bot okur (AutoRegisterQueue için) ve bot DB'ye yazar, admin paneli okur (lessons, students için).

2. **AutoRegisterQueue akışı:**
   - Admin panel → `AutoRegisterQueue`'ya satır ekler
   - Bot 60sn'de bir tabloyu kontrol eder
   - Eşleşme bulunursa `students` tablosuna ekler, `AutoRegisterQueue.processed = true` yapar
   - Admin panel bu durumu gösterir (processed: true/false badge)

3. **Çakışma önleme:** `Student.discordId` unique constraint var, aynı kişi iki kez kaydedilemez.

4. **Silme işlemleri:** Student silindiğinde ilişkili lessons da silinmeli (cascade delete — Prisma'da `onDelete: Cascade` ekle).
