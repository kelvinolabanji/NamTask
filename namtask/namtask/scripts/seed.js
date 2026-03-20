require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../src/config/database');

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🌱 Seeding Nam Task database with Namibia data...');

    // ── Users ──────────────────────────────────────────────
    const adminId = uuidv4();
    const customer1Id = uuidv4();
    const customer2Id = uuidv4();
    const tasker1Id = uuidv4();
    const tasker2Id = uuidv4();
    const tasker3Id = uuidv4();

    const adminHash = await bcrypt.hash('Admin@123456', ROUNDS);
    const userHash  = await bcrypt.hash('Password@123', ROUNDS);

    const users = [
      [adminId,    'Admin User',       '+264811000000', 'admin@namtask.com',          adminHash, 'admin'],
      [customer1Id,'Maria Nghipunya',  '+264811234567', 'maria@example.com',          userHash,  'customer'],
      [customer2Id,'Johannes Iipinge', '+264812345678', 'johannes@example.com',       userHash,  'customer'],
      [tasker1Id,  'Petrus Hamunyela', '+264813456789', 'petrus@example.com',         userHash,  'tasker'],
      [tasker2Id,  'Selma Nakashole',  '+264814567890', 'selma@example.com',          userHash,  'tasker'],
      [tasker3Id,  'David Amutenya',   '+264815678901', 'david@example.com',          userHash,  'tasker'],
    ];

    for (const [id, name, phone, email, hash, role] of users) {
      await client.query(
        `INSERT INTO users (id, name, phone, email, password_hash, role, rating, rating_count, is_verified)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [id, name, phone, email, hash, role, (Math.random()*2+3).toFixed(2), Math.floor(Math.random()*50+5), true]
      );
    }

    // ── Wallets ────────────────────────────────────────────
    for (const userId of [adminId, customer1Id, customer2Id, tasker1Id, tasker2Id, tasker3Id]) {
      await client.query(
        `INSERT INTO wallets (user_id, balance) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, (Math.random()*500+100).toFixed(2)]
      );
    }

    // ── Tasker Profiles ────────────────────────────────────
    const taskerProfiles = [
      [tasker1Id, 'Experienced cleaner and handyman based in Windhoek. 5+ years experience.',
       ['cleaning','plumbing','electrical'], ['cleaning','repairs'], 80, 'approved'],
      [tasker2Id, 'Professional tutor for Math, Science and English. University graduate.',
       ['tutoring','teaching','childcare'], ['tutoring','caregiving'], 120, 'approved'],
      [tasker3Id, 'Reliable delivery driver with own vehicle. Covering all of Windhoek.',
       ['delivery','moving','errands'], ['delivery','moving'], 60, 'approved'],
    ];

    for (const [uid, bio, skills, cats, rate, status] of taskerProfiles) {
      await client.query(
        `INSERT INTO tasker_profiles (user_id, bio, skills, categories, hourly_rate, verification_status, background_check_passed, total_tasks_completed)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7) ON CONFLICT DO NOTHING`,
        [uid, bio, skills, cats, rate, status, Math.floor(Math.random()*80+10)]
      );
    }

    // ── Tasks (Windhoek coordinates) ───────────────────────
    const taskId1 = uuidv4();
    const taskId2 = uuidv4();
    const taskId3 = uuidv4();
    const taskId4 = uuidv4();

    // Windhoek area coords: ~-22.56, 17.08
    const tasks = [
      [taskId1, customer1Id, tasker1Id, 'Deep Clean 3-Bedroom House', 'Need thorough cleaning of entire house including bathrooms and kitchen', 'cleaning', 350, 'completed', -22.5597, 17.0832, 'Klein Windhoek'],
      [taskId2, customer2Id, null,      'Deliver Documents to MTC Office', 'Urgent delivery of signed contracts to MTC headquarters Windhoek', 'delivery', 150, 'pending',   -22.5609, 17.0658, 'Windhoek Central'],
      [taskId3, customer1Id, tasker2Id, 'Grade 12 Maths Tutoring Session', 'Need help with calculus and statistics for upcoming exams', 'tutoring', 200, 'in_progress',-22.5731, 17.0793, 'Pioneers Park'],
      [taskId4, customer2Id, tasker3Id, 'Help Moving Furniture to New Flat', 'Moving 2-bedroom furniture from Katutura to Khomasdal', 'moving',   500, 'accepted',  -22.5445, 17.0600, 'Katutura'],
    ];

    for (const [id, cid, tid, title, desc, cat, budget, status, lat, lng, city] of tasks) {
      await client.query(
        `INSERT INTO tasks (id, customer_id, tasker_id, title, description, category, budget, status, location, location_address, location_city, scheduled_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, ST_SetSRID(ST_MakePoint($9,$10),4326),$11,$12, NOW() + INTERVAL '1 day')
         ON CONFLICT DO NOTHING`,
        [id, cid, tid, title, desc, cat, budget, status, lng, lat, `Windhoek, ${city}`, city]
      );
    }

    // ── Reviews ────────────────────────────────────────────
    await client.query(
      `INSERT INTO reviews (task_id, reviewer_id, reviewee_id, rating, comment)
       VALUES ($1,$2,$3,5,'Petrus did an amazing job! House was spotless. Very professional and punctual.')
       ON CONFLICT DO NOTHING`,
      [taskId1, customer1Id, tasker1Id]
    );

    // ── Notifications ──────────────────────────────────────
    await client.query(
      `INSERT INTO notifications (user_id, type, title, message, data) VALUES
       ($1,'task_accepted','Task Accepted','Your cleaning task has been accepted by Petrus','{"task_id":"${taskId1}"}'),
       ($2,'task_offer','New Task Available','A delivery task is available near you','{"task_id":"${taskId2}"}')`,
      [customer1Id, tasker3Id]
    );

    await client.query('COMMIT');
    console.log('✅ Seeding complete!');
    console.log('\n🔐 Test Credentials:');
    console.log('   Admin:    admin@namtask.com / Admin@123456');
    console.log('   Customer: maria@example.com / Password@123');
    console.log('   Tasker:   petrus@example.com / Password@123');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seeding failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
