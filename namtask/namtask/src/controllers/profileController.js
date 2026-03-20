const { query } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

const update = async (req, res, next) => {
  try {
    const { name, email } = req.body;
    const avatar_url = req.file ? `/uploads/avatars/${req.file.filename}` : undefined;

    const fields = [];
    const vals   = [];
    let   idx    = 1;

    if (name)       { fields.push(`name=$${idx++}`);       vals.push(name); }
    if (email)      { fields.push(`email=$${idx++}`);      vals.push(email); }
    if (avatar_url) { fields.push(`avatar_url=$${idx++}`); vals.push(avatar_url); }

    if (!fields.length) throw new AppError('Nothing to update', 400);

    vals.push(req.user.id);
    const result = await query(
      `UPDATE users SET ${fields.join(',')} WHERE id=$${idx} RETURNING id,name,email,avatar_url`,
      vals
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

const updateTaskerProfile = async (req, res, next) => {
  try {
    const { bio, skills, categories, hourly_rate, service_radius_km, availability } = req.body;
    const result = await query(
      `UPDATE tasker_profiles
       SET bio=COALESCE($1,bio), skills=COALESCE($2,skills), categories=COALESCE($3,categories),
           hourly_rate=COALESCE($4,hourly_rate), service_radius_km=COALESCE($5,service_radius_km),
           availability=COALESCE($6,availability)
       WHERE user_id=$7 RETURNING *`,
      [bio, skills, categories, hourly_rate, service_radius_km,
       availability ? JSON.stringify(availability) : null, req.user.id]
    );
    if (!result.rows.length) throw new AppError('Tasker profile not found', 404);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

module.exports = { update, updateTaskerProfile };
