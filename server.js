require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
// Use process.env.PORT for Render deployment, fallback to 3001 locally
const PORT = process.env.PORT || 3001;

app.use(cors());
// Need high limit because employee list with base64 images could get large
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// Initialize PostgreSQL connection pool
// IMPORTANT: Render will provide process.env.DATABASE_URL automatically.
// For local development, you must add DATABASE_URL to your .env file.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('Error connecting to PostgreSQL database', err.stack);
    } else {
        console.log('Connected to PostgreSQL database.');
        
        // Simple Key-Value store table for JSON strings
        client.query(`
            CREATE TABLE IF NOT EXISTS store (
                key VARCHAR PRIMARY KEY,
                value TEXT
            )
        `, (queryErr) => {
            release();
            if (queryErr) {
                console.error('Error creating table', queryErr.stack);
            }
        });
    }
});

// --- API Endpoints ---

// Get data for a specific key
app.get('/api/sync/:key', async (req, res) => {
    const { key } = req.params;
    try {
        const result = await pool.query(`SELECT value FROM store WHERE key = $1`, [key]);
        if (result.rows.length > 0 && result.rows[0].value) {
            try {
                res.json(JSON.parse(result.rows[0].value));
            } catch (e) {
                res.json([]);
            }
        } else {
            res.json([]); // Return empty array if key not found
        }
    } catch (err) {
        console.error('DB Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Save data for a specific key
app.post('/api/sync/:key', async (req, res) => {
    const { key } = req.params;
    const value = JSON.stringify(req.body);
    
    try {
        // Insert or Replace (PostgreSQL syntax)
        await pool.query(`
            INSERT INTO store (key, value) 
            VALUES ($1, $2) 
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `, [key, value]);
        
        res.json({ success: true });
    } catch (err) {
        console.error('DB Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
