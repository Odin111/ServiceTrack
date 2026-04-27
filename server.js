const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
// Use process.env.PORT for Render deployment, fallback to 3001 locally
const PORT = process.env.PORT || 3001;

app.use(cors());
// Need high limit because employee list with base64 images could get large
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// Initialize SQLite database
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to SQLite database.');
        
        // Simple Key-Value store table for JSON strings
        db.run(`CREATE TABLE IF NOT EXISTS store (
            key TEXT PRIMARY KEY,
            value TEXT
        )`);
    }
});

// --- API Endpoints ---

// Get data for a specific key
app.get('/api/sync/:key', (req, res) => {
    const { key } = req.params;
    db.get(`SELECT value FROM store WHERE key = ?`, [key], (err, row) => {
        if (err) {
            console.error('DB Error:', err);
            return res.status(500).json({ error: err.message });
        }
        if (row && row.value) {
            try {
                res.json(JSON.parse(row.value));
            } catch (e) {
                res.json([]);
            }
        } else {
            res.json([]); // Return empty array if key not found
        }
    });
});

// Save data for a specific key
app.post('/api/sync/:key', (req, res) => {
    const { key } = req.params;
    const value = JSON.stringify(req.body);
    
    // Insert or Replace
    db.run(`INSERT INTO store (key, value) VALUES (?, ?) 
            ON CONFLICT(key) DO UPDATE SET value=excluded.value`, 
    [key, value], (err) => {
        if (err) {
            console.error('DB Error:', err);
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
