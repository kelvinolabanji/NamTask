const notifService = require('../services/notificationService');

const list = async (req, res, next) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const data = await notifService.getUserNotifications(req.user.id, { page: parseInt(page), limit: parseInt(limit) });
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

const markRead = async (req, res, next) => {
  try {
    await notifService.markRead(req.user.id, null);
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) { next(err); }
};

const markOneRead = async (req, res, next) => {
  try {
    await notifService.markRead(req.user.id, req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
};

module.exports = { list, markRead, markOneRead };
