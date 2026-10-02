const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env or configure it in Render.");
}

// Render's managed Postgres requires SSL. Local Postgres usually does not.
const isRender = /render\.com|\.render\.|amazonaws/.test(process.env.DATABASE_URL || "");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" || isRender ? { rejectUnauthorized: false } : false,
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
