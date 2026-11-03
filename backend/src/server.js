import pool from './config/db.js';  
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import adminRoutes from './routes/adminRoutes.js';
import authRoutes from './routes/authRoutes.js';
import otpRoutes from './routes/otpRoutes.js';
import memberRoutes from './routes/memberRoutes.js';
const app = express();
const port = Number(process.env.PORT || 4000);

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));


app.get('/api/health/db', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS total_tables FROM information_schema.tables WHERE table_schema = ?',
      ['funeral_services']
    );

    res.json({
      status: 'ok',
      database: 'connected',
      databaseName: 'funeral_services',
      totalTables: rows[0].total_tables,
    });
  } catch (error) {
    console.error('Database health check failed:', error.message);

    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      message: 'Database connection failed',
    });
  }
});

app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/auth/otp', otpRoutes);
app.use('/api/member', memberRoutes);
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'funeral-services-api', timestamp: new Date().toISOString() });
});

app.use((_req, res) => res.status(404).json({ error: 'Found', message: 'Endpoint not found.' }));

app.listen(port, () => {
  console.log(`Funeral Services API listening on http://localhost:${port}`);
});
