'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const fmtDate = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  return new Date(v).toISOString().slice(0, 10);
};

const publicApp = (row) => ({
  id: row.id,
  customer: {
    name: row.name,
    email: row.email,
    phone: row.phone,
    employer: row.employer,
  },
  requested_amount: parseFloat(row.requested_amount),
  payday: fmtDate(row.payday),
  status: row.status,
  plaid_connected: Boolean(row.access_token),
  repayment: row.repayment_amount != null ? {
    amount: parseFloat(row.repayment_amount),
    due_date: fmtDate(row.repayment_due_date),
    status: row.repayment_status || 'pending',
    note: row.repayment_note || '',
    created_at: row.updated_at,
  } : null,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

async function createApplication({ name, email, phone, employer, payday, requested_amount, password_hash }) {
  const { rows } = await pool.query(
    `INSERT INTO applications (name, email, phone, employer, payday, requested_amount, password_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, email, phone, employer, payday, requested_amount || 50, password_hash],
  );
  return rows[0];
}

async function getApplicationById(id) {
  const { rows } = await pool.query('SELECT * FROM applications WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getApplicationByEmail(email) {
  const { rows } = await pool.query(
    'SELECT * FROM applications WHERE LOWER(email) = LOWER($1)', [email],
  );
  return rows[0] || null;
}

async function getAllApplications() {
  const { rows } = await pool.query('SELECT * FROM applications ORDER BY created_at DESC');
  return rows;
}

async function updateApplicationStatus(id, status) {
  const { rows } = await pool.query(
    'UPDATE applications SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
    [status, id],
  );
  return rows[0] || null;
}

async function setAccessToken(id, access_token, item_id) {
  const { rows } = await pool.query(
    `UPDATE applications SET access_token=$1, item_id=$2, status='bank_connected', updated_at=NOW()
     WHERE id=$3 RETURNING *`,
    [access_token, item_id, id],
  );
  return rows[0] || null;
}

async function setRepayment(id, amount, due_date, note) {
  const { rows } = await pool.query(
    `UPDATE applications
     SET repayment_amount=$1, repayment_due_date=$2, repayment_note=$3,
         repayment_status='pending', status='repayment_scheduled', updated_at=NOW()
     WHERE id=$4 RETURNING *`,
    [amount, due_date, note || '', id],
  );
  return rows[0] || null;
}

async function markRepaymentPaid(id) {
  const { rows } = await pool.query(
    `UPDATE applications SET repayment_status='paid', status='repaid', updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [id],
  );
  return rows[0] || null;
}

async function addMessage(application_id, sender, text) {
  const { rows } = await pool.query(
    'INSERT INTO messages (application_id, sender, text) VALUES ($1,$2,$3) RETURNING *',
    [application_id, sender, text],
  );
  return rows[0];
}

async function getMessages(application_id) {
  const { rows } = await pool.query(
    'SELECT * FROM messages WHERE application_id=$1 ORDER BY created_at ASC',
    [application_id],
  );
  return rows;
}

module.exports = {
  publicApp,
  createApplication,
  getApplicationById,
  getApplicationByEmail,
  getAllApplications,
  updateApplicationStatus,
  setAccessToken,
  setRepayment,
  markRepaymentPaid,
  addMessage,
  getMessages,
};
