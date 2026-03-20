const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

const createStorage = (folder) =>
  multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(process.env.UPLOAD_PATH || './uploads', folder)),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${uuidv4()}${ext}`);
    },
  });

const fileFilter = (req, file, cb) => {
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and WebP images are allowed'), false);
  }
};

const limits = { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 };

const uploadTaskImages = multer({ storage: createStorage('tasks'), fileFilter, limits }).array('images', 5);
const uploadAvatar      = multer({ storage: createStorage('avatars'), fileFilter, limits }).single('avatar');
const uploadProof       = multer({ storage: createStorage('proofs'), fileFilter, limits }).single('proof');

module.exports = { uploadTaskImages, uploadAvatar, uploadProof };
