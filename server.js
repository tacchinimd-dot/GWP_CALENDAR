const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.RENDER ? '/tmp/data' : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'calendar-data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize data file
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Data load error:', e.message);
  }
  return { notes: {}, current: [], upcoming: [], users: {} };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  saveData({ notes: {}, current: [], upcoming: [], users: {} });
}

// Get client IP
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

// --- API Routes ---

// Register / identify user
app.post('/api/register', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '이름을 입력해주세요.' });

  const ip = getClientIP(req);
  const data = loadData();
  const userId = `user_${ip.replace(/[.:]/g, '_')}`;

  data.users[userId] = {
    name: name.trim(),
    ip,
    lastAccess: new Date().toISOString()
  };
  saveData(data);

  res.json({ userId, name: name.trim(), ip });
});

// Get current user by IP
app.get('/api/me', (req, res) => {
  const ip = getClientIP(req);
  const data = loadData();
  const userId = `user_${ip.replace(/[.:]/g, '_')}`;
  const user = data.users[userId];

  if (user) {
    // Update last access
    data.users[userId].lastAccess = new Date().toISOString();
    saveData(data);
    res.json({ userId, name: user.name, ip });
  } else {
    res.json({ userId: null, name: null, ip });
  }
});

// Get all registered users
app.get('/api/users', (req, res) => {
  const data = loadData();
  const users = Object.entries(data.users).map(([id, u]) => ({
    id, name: u.name, lastAccess: u.lastAccess
  }));
  res.json(users);
});

// Get all calendar data
app.get('/api/data', (req, res) => {
  const data = loadData();
  res.json({ notes: data.notes, current: data.current, upcoming: data.upcoming });
});

// Add note to a day
app.post('/api/notes', (req, res) => {
  const { dayKey, text, start, end, userId, userName } = req.body;
  if (!dayKey || !text) return res.status(400).json({ error: '필수 항목 누락' });

  const data = loadData();
  if (!data.notes[dayKey]) data.notes[dayKey] = [];
  data.notes[dayKey].push({
    text,
    start: start || '',
    end: end || '',
    author: userName || '알 수 없음',
    authorId: userId || '',
    createdAt: new Date().toISOString()
  });
  saveData(data);
  res.json({ success: true, notes: data.notes });
});

// Delete note from a day
app.delete('/api/notes/:dayKey/:index', (req, res) => {
  const { dayKey, index } = req.params;
  const data = loadData();
  if (data.notes[dayKey] && data.notes[dayKey][+index] !== undefined) {
    data.notes[dayKey].splice(+index, 1);
    if (data.notes[dayKey].length === 0) delete data.notes[dayKey];
    saveData(data);
  }
  res.json({ success: true, notes: data.notes });
});

// Add task (current or upcoming)
app.post('/api/tasks/:type', (req, res) => {
  const { type } = req.params;
  if (type !== 'current' && type !== 'upcoming') return res.status(400).json({ error: 'Invalid type' });

  const { text, start, end, userId, userName } = req.body;
  if (!text) return res.status(400).json({ error: '제목을 입력해주세요.' });

  const data = loadData();
  data[type].push({
    text,
    start: start || '',
    end: end || '',
    done: false,
    id: Date.now(),
    author: userName || '알 수 없음',
    authorId: userId || '',
    createdAt: new Date().toISOString()
  });
  saveData(data);
  res.json({ success: true, current: data.current, upcoming: data.upcoming });
});

// Toggle task done
app.patch('/api/tasks/:type/:id', (req, res) => {
  const { type, id } = req.params;
  const data = loadData();
  const item = data[type]?.find(t => t.id === +id);
  if (item) {
    item.done = !item.done;
    saveData(data);
  }
  res.json({ success: true, current: data.current, upcoming: data.upcoming });
});

// Delete task
app.delete('/api/tasks/:type/:id', (req, res) => {
  const { type, id } = req.params;
  const data = loadData();
  data[type] = (data[type] || []).filter(t => t.id !== +id);
  saveData(data);
  res.json({ success: true, current: data.current, upcoming: data.upcoming });
});

// Activity log (recent changes)
app.get('/api/activity', (req, res) => {
  const data = loadData();
  const activities = [];

  // Collect from notes
  Object.entries(data.notes).forEach(([day, notes]) => {
    notes.forEach(n => {
      activities.push({
        type: 'note', day, text: n.text, author: n.author,
        createdAt: n.createdAt
      });
    });
  });

  // Collect from tasks
  ['current', 'upcoming'].forEach(type => {
    (data[type] || []).forEach(t => {
      activities.push({
        type: type === 'current' ? '진행중' : '예정',
        text: t.text, author: t.author, createdAt: t.createdAt
      });
    });
  });

  // Sort by date desc, limit 30
  activities.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json(activities.slice(0, 30));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ST 에코백 캘린더 서버 실행 중: http://0.0.0.0:${PORT}`);
});
