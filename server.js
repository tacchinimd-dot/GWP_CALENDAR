const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database tables
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ip TEXT,
      last_access TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY,
      day_key TEXT NOT NULL,
      text TEXT NOT NULL,
      start_date TEXT DEFAULT '',
      end_date TEXT DEFAULT '',
      author TEXT DEFAULT '알 수 없음',
      author_id TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('current', 'upcoming')),
      text TEXT NOT NULL,
      start_date TEXT DEFAULT '',
      end_date TEXT DEFAULT '',
      done BOOLEAN DEFAULT FALSE,
      author TEXT DEFAULT '알 수 없음',
      author_id TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('DB 테이블 초기화 완료');
}

// Get client IP
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

// --- API Routes ---

// Register / identify user
app.post('/api/register', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '이름을 입력해주세요.' });

    const ip = getClientIP(req);
    const userId = `user_${ip.replace(/[.:]/g, '_')}`;

    await pool.query(
      `INSERT INTO users (user_id, name, ip, last_access) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET name = $2, last_access = NOW()`,
      [userId, name.trim(), ip]
    );

    res.json({ userId, name: name.trim(), ip });
  } catch (e) {
    console.error('Register error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current user by IP
app.get('/api/me', async (req, res) => {
  try {
    const ip = getClientIP(req);
    const userId = `user_${ip.replace(/[.:]/g, '_')}`;

    const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
    if (result.rows.length > 0) {
      await pool.query('UPDATE users SET last_access = NOW() WHERE user_id = $1', [userId]);
      res.json({ userId, name: result.rows[0].name, ip });
    } else {
      res.json({ userId: null, name: null, ip });
    }
  } catch (e) {
    console.error('Me error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all registered users
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT user_id as id, name, last_access FROM users ORDER BY last_access DESC');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all calendar data
app.get('/api/data', async (req, res) => {
  try {
    const notesResult = await pool.query('SELECT * FROM notes ORDER BY created_at');
    const currentResult = await pool.query("SELECT * FROM tasks WHERE type = 'current' ORDER BY created_at");
    const upcomingResult = await pool.query("SELECT * FROM tasks WHERE type = 'upcoming' ORDER BY created_at");

    // Group notes by day_key
    const notes = {};
    notesResult.rows.forEach(n => {
      if (!notes[n.day_key]) notes[n.day_key] = [];
      notes[n.day_key].push({
        text: n.text, start: n.start_date, end: n.end_date,
        author: n.author, authorId: n.author_id, createdAt: n.created_at
      });
    });

    const mapTask = t => ({
      id: t.id, text: t.text, start: t.start_date, end: t.end_date,
      done: t.done, author: t.author, authorId: t.author_id, createdAt: t.created_at
    });

    res.json({
      notes,
      current: currentResult.rows.map(mapTask),
      upcoming: upcomingResult.rows.map(mapTask)
    });
  } catch (e) {
    console.error('Data error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add note to a day
app.post('/api/notes', async (req, res) => {
  try {
    const { dayKey, text, start, end, userId, userName } = req.body;
    if (!dayKey || !text) return res.status(400).json({ error: '필수 항목 누락' });

    await pool.query(
      'INSERT INTO notes (day_key, text, start_date, end_date, author, author_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [dayKey, text, start || '', end || '', userName || '알 수 없음', userId || '']
    );

    // Return updated notes
    const notesResult = await pool.query('SELECT * FROM notes ORDER BY created_at');
    const notes = {};
    notesResult.rows.forEach(n => {
      if (!notes[n.day_key]) notes[n.day_key] = [];
      notes[n.day_key].push({
        text: n.text, start: n.start_date, end: n.end_date,
        author: n.author, authorId: n.author_id, createdAt: n.created_at
      });
    });

    res.json({ success: true, notes });
  } catch (e) {
    console.error('Note add error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete note
app.delete('/api/notes/:dayKey/:index', async (req, res) => {
  try {
    const { dayKey, index } = req.params;

    // Get the specific note by day_key and index
    const notesForDay = await pool.query(
      'SELECT id FROM notes WHERE day_key = $1 ORDER BY created_at', [dayKey]
    );
    if (notesForDay.rows[+index]) {
      await pool.query('DELETE FROM notes WHERE id = $1', [notesForDay.rows[+index].id]);
    }

    // Return updated notes
    const notesResult = await pool.query('SELECT * FROM notes ORDER BY created_at');
    const notes = {};
    notesResult.rows.forEach(n => {
      if (!notes[n.day_key]) notes[n.day_key] = [];
      notes[n.day_key].push({
        text: n.text, start: n.start_date, end: n.end_date,
        author: n.author, authorId: n.author_id, createdAt: n.created_at
      });
    });

    res.json({ success: true, notes });
  } catch (e) {
    console.error('Note delete error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add task
app.post('/api/tasks/:type', async (req, res) => {
  try {
    const { type } = req.params;
    if (type !== 'current' && type !== 'upcoming') return res.status(400).json({ error: 'Invalid type' });

    const { text, start, end, userId, userName } = req.body;
    if (!text) return res.status(400).json({ error: '제목을 입력해주세요.' });

    await pool.query(
      'INSERT INTO tasks (type, text, start_date, end_date, author, author_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [type, text, start || '', end || '', userName || '알 수 없음', userId || '']
    );

    const currentResult = await pool.query("SELECT * FROM tasks WHERE type = 'current' ORDER BY created_at");
    const upcomingResult = await pool.query("SELECT * FROM tasks WHERE type = 'upcoming' ORDER BY created_at");
    const mapTask = t => ({
      id: t.id, text: t.text, start: t.start_date, end: t.end_date,
      done: t.done, author: t.author, authorId: t.author_id, createdAt: t.created_at
    });

    res.json({ success: true, current: currentResult.rows.map(mapTask), upcoming: upcomingResult.rows.map(mapTask) });
  } catch (e) {
    console.error('Task add error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Toggle task done
app.patch('/api/tasks/:type/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE tasks SET done = NOT done WHERE id = $1', [+id]);

    const currentResult = await pool.query("SELECT * FROM tasks WHERE type = 'current' ORDER BY created_at");
    const upcomingResult = await pool.query("SELECT * FROM tasks WHERE type = 'upcoming' ORDER BY created_at");
    const mapTask = t => ({
      id: t.id, text: t.text, start: t.start_date, end: t.end_date,
      done: t.done, author: t.author, authorId: t.author_id, createdAt: t.created_at
    });

    res.json({ success: true, current: currentResult.rows.map(mapTask), upcoming: upcomingResult.rows.map(mapTask) });
  } catch (e) {
    console.error('Task toggle error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete task
app.delete('/api/tasks/:type/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM tasks WHERE id = $1', [+id]);

    const currentResult = await pool.query("SELECT * FROM tasks WHERE type = 'current' ORDER BY created_at");
    const upcomingResult = await pool.query("SELECT * FROM tasks WHERE type = 'upcoming' ORDER BY created_at");
    const mapTask = t => ({
      id: t.id, text: t.text, start: t.start_date, end: t.end_date,
      done: t.done, author: t.author, authorId: t.author_id, createdAt: t.created_at
    });

    res.json({ success: true, current: currentResult.rows.map(mapTask), upcoming: upcomingResult.rows.map(mapTask) });
  } catch (e) {
    console.error('Task delete error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Activity log
app.get('/api/activity', async (req, res) => {
  try {
    const notesResult = await pool.query('SELECT day_key, text, author, created_at FROM notes ORDER BY created_at DESC LIMIT 30');
    const tasksResult = await pool.query('SELECT type, text, author, created_at FROM tasks ORDER BY created_at DESC LIMIT 30');

    const activities = [];
    notesResult.rows.forEach(n => {
      activities.push({ type: 'note', day: n.day_key, text: n.text, author: n.author, createdAt: n.created_at });
    });
    tasksResult.rows.forEach(t => {
      activities.push({
        type: t.type === 'current' ? '진행중' : '예정',
        text: t.text, author: t.author, createdAt: t.created_at
      });
    });

    activities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(activities.slice(0, 30));
  } catch (e) {
    console.error('Activity error:', e.message);
    res.json([]);
  }
});

// Start server
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ST 에코백 캘린더 서버 실행 중: http://0.0.0.0:${PORT}`);
  });
}).catch(err => {
  console.error('DB 초기화 실패:', err.message, err.stack);
  console.error('DATABASE_URL:', process.env.DATABASE_URL ? '설정됨 (' + process.env.DATABASE_URL.substring(0, 30) + '...)' : '미설정');
  process.exit(1);
});
