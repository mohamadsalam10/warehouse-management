require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "sql", "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Schema applied.");
}

module.exports = { migrate };

// Allow running directly: `npm run migrate`
if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
