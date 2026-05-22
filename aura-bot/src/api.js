const express = require('express');
const cors = require('cors');
const prisma = require('./db');

const app = express();
const PORT = process.env.API_PORT || 4000;
const API_SECRET_KEY = process.env.API_SECRET_KEY || '';

app.use(cors());
app.use(express.json());

// ─── API KEY KONTROLÜ ─────────────────────────────────────────────────────────
function requireApiKey(req, res, next) {
  if (!API_SECRET_KEY) return next();
  const key = req.headers['x-api-key'];
  if (key !== API_SECRET_KEY) {
    return res.status(401).json({ success: false, error: 'Yetkisiz erisim' });
  }
  next();
}

// ─── TUM OGRENCILER ───────────────────────────────────────────────────────────
app.get('/api/bot/students', requireApiKey, async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      orderBy: { totalLessons: 'desc' },
    });

    // Admin panelin beklediği field isimleri
    const mapped = students.map(s => ({
      name:           s.name,
      discordId:      s.discordId,
      discordUsername: s.discordUsername,
      totalLessons:   s.totalLessons,
      remainingLessons: s.remainingLessons,
      isActive:       s.isActive,
      rank:           s.rank,
      targetRank:     s.targetRank,
      packageType:    s.packageType,
      lastLessonDate: s.updatedAt ? s.updatedAt.toISOString().split('T')[0] : null,
      registeredAt:   s.registeredAt,
      createdAt:      s.registeredAt,
    }));

    res.json({ success: true, students: mapped });
  } catch (e) {
    console.error('[BOT-API] /api/bot/students hata:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── TEK OGRENCI + DERS GECMISi ──────────────────────────────────────────────
app.get('/api/bot/students/:discordId', requireApiKey, async (req, res) => {
  try {
    const student = await prisma.student.findUnique({
      where: { discordId: req.params.discordId },
    });

    if (!student) {
      return res.status(404).json({ success: false, error: 'Ogrenci bulunamadi' });
    }

    const rawLessons = await prisma.lesson.findMany({
      where:   { studentId: student.id },
      orderBy: { startedAt: 'desc' },
      take:    20,
    });

    // Admin panelin beklediği lesson field isimleri
    const lessons = rawLessons.map(l => ({
      lessonNumber: l.lessonNumber,
      date:         l.startedAt ? l.startedAt.toISOString().split('T')[0] : null,
      category:     l.category,
      instructorId: l.coachId,
      timestamp:    l.startedAt,
      durationMins: l.durationMins,
      notes:        l.notes,
    }));

    const mapped = {
      name:            student.name,
      discordId:       student.discordId,
      discordUsername: student.discordUsername,
      totalLessons:    student.totalLessons,
      remainingLessons: student.remainingLessons,
      isActive:        student.isActive,
      rank:            student.rank,
      targetRank:      student.targetRank,
      packageType:     student.packageType,
      lastLessonDate:  student.updatedAt ? student.updatedAt.toISOString().split('T')[0] : null,
      registeredAt:    student.registeredAt,
      createdAt:       student.registeredAt,
    };

    res.json({ success: true, student: mapped, lessons });
  } catch (e) {
    console.error('[BOT-API] /api/bot/students/:id hata:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── TUM DERSLER (sayfali) ────────────────────────────────────────────────────
app.get('/api/bot/lessons', requireApiKey, async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip  = (page - 1) * limit;

    const [total, rawLessons] = await Promise.all([
      prisma.lesson.count(),
      prisma.lesson.findMany({
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
        include: { student: true },
      }),
    ]);

    // Admin panelin beklediği lesson field isimleri
    const lessons = rawLessons.map(l => ({
      lessonNumber: l.lessonNumber,
      studentName:  l.student ? `${l.student.name} ${l.student.surname}` : '-',
      date:         l.startedAt ? l.startedAt.toISOString().split('T')[0] : null,
      category:     l.category,
      instructorId: l.coachId,
      timestamp:    l.startedAt,
      durationMins: l.durationMins,
    }));

    res.json({
      success: true,
      lessons,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (e) {
    console.error('[BOT-API] /api/bot/lessons hata:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── ISTATISTIKLER ────────────────────────────────────────────────────────────
app.get('/api/bot/stats', requireApiKey, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dates = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      dates.push(d.toISOString().split('T')[0]);
    }
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

    const [totalStudents, totalLessons, todayLessons, topStudent, recentLessons] = await Promise.all([
      prisma.student.count(),
      prisma.lesson.count(),
      prisma.lesson.count({ where: { startedAt: { gte: today } } }),
      prisma.student.findFirst({ orderBy: { totalLessons: 'desc' } }),
      prisma.lesson.findMany({
        where:  { startedAt: { gte: sevenDaysAgo } },
        select: { startedAt: true, coachId: true, category: true },
      }),
    ]);

    const last7Map      = new Map(dates.map(d => [d, 0]));
    const instructorMap = new Map();
    const categoryMap   = new Map();

    for (const l of recentLessons) {
      const d = l.startedAt.toISOString().split('T')[0];
      if (last7Map.has(d)) last7Map.set(d, last7Map.get(d) + 1);
      instructorMap.set(l.coachId, (instructorMap.get(l.coachId) || 0) + 1);
      if (l.category) categoryMap.set(l.category, (categoryMap.get(l.category) || 0) + 1);
    }

    res.json({
      success: true,
      stats: {
        totalStudents,
        totalLessons,
        todayLessons,
        topStudent: topStudent
          ? { name: topStudent.name, totalLessons: topStudent.totalLessons }
          : null,
        last7Days:    dates.map(d => ({ date: d, count: last7Map.get(d) || 0 })),
        topInstructors: [...instructorMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, count]) => ({ id, count })),
        topCategories:  [...categoryMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cat, count]) => ({ cat, count })),
      },
    });
  } catch (e) {
    console.error('[BOT-API] /api/bot/stats hata:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── DISCORD ID VEYA ISIMLE ARA ───────────────────────────────────────────────
app.get('/api/bot/match/:discord', requireApiKey, async (req, res) => {
  try {
    const term = req.params.discord;

    const student = await prisma.student.findFirst({
      where: {
        OR: [
          { discordId: term },
          { discordUsername: { contains: term, mode: 'insensitive' } },
          { name:            { contains: term, mode: 'insensitive' } },
        ],
      },
    });

    if (!student) {
      return res.json({ success: false, error: 'Bulunamadi' });
    }

    const rawLessons = await prisma.lesson.findMany({
      where:   { studentId: student.id },
      orderBy: { startedAt: 'desc' },
      take:    20,
    });

    const lessons = rawLessons.map(l => ({
      lessonNumber: l.lessonNumber,
      date:         l.startedAt ? l.startedAt.toISOString().split('T')[0] : null,
      category:     l.category,
      instructorId: l.coachId,
      timestamp:    l.startedAt,
      durationMins: l.durationMins,
    }));

    const mapped = {
      name:            student.name,
      discordId:       student.discordId,
      discordUsername: student.discordUsername,
      totalLessons:    student.totalLessons,
      remainingLessons: student.remainingLessons,
      isActive:        student.isActive,
      rank:            student.rank,
      targetRank:      student.targetRank,
      packageType:     student.packageType,
      lastLessonDate:  student.updatedAt ? student.updatedAt.toISOString().split('T')[0] : null,
      registeredAt:    student.registeredAt,
    };

    res.json({ success: true, student: mapped, lessons });
  } catch (e) {
    console.error('[BOT-API] /api/bot/match hata:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── SAGLIK KONTROLU ──────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'AURA Bot API calisiyor', port: PORT });
});

// ─── SUNUCUYU BASLAT ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[BOT-API] API sunucusu calisiyor — Port: ${PORT}`);
});

module.exports = app;
