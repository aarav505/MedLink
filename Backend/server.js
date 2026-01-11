const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');
const multer = require('multer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// JWT secret key - should be in environment variables in production
const JWT_SECRET = 'your-jwt-secret-key-here';

// Twilio setup - replace with your actual credentials
// const TWILIO_ACCOUNT_SID = 'your_twilio_account_sid';
// const TWILIO_AUTH_TOKEN = 'your_twilio_auth_token';
// const TWILIO_PHONE_NUMBER = 'your_twilio_phone_number';
// const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Ensure directories exist
const UPLOADS_DIR = path.join(__dirname, 'public/images/medicines');
fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(path.join(__dirname, '../Data'));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function(req, file, cb) {
    // Generate unique filename with original extension
    const fileExt = path.extname(file.originalname);
    const uniqueName = crypto.randomBytes(16).toString('hex') + fileExt;
    cb(null, uniqueName);
  }
});

// Filter to accept only image files
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max file size
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../Frontend')));
app.use('/images/medicines', express.static(path.join(__dirname, 'public/images/medicines')));

// CSV file paths
const MEDICINES_CSV_PATH = path.join(__dirname, '../Data/listings.csv');
const USERS_CSV_PATH = path.join(__dirname, '../Data/users.csv');
const PHARMACISTS_CSV_PATH = path.join(__dirname, '../Data/pharmacists.csv');
const PROFESSIONALS_CSV_PATH = path.join(__dirname, '../Data/professionals.csv');
const FEEDBACK_CSV_PATH = path.join(__dirname, '../Data/feedback.csv');
const NEWSLETTER_CSV_PATH = path.join(__dirname, '../Data/newsletter.csv');

// Initialize CSV files with headers if they don't exist
if (!fs.existsSync(MEDICINES_CSV_PATH)) {
  fs.writeFileSync(MEDICINES_CSV_PATH, 'id,name,expiry,condition,price,timestamp,image,status\n');
  console.log('Created new listings.csv file with headers');
} else {
  // Ensure status column exists in header (migration for existing installs)
  const lines = fs.readFileSync(MEDICINES_CSV_PATH, 'utf-8').split('\n');
  if (lines[0] && !lines[0].includes('status')) {
    lines[0] = 'id,name,expiry,condition,price,timestamp,image,status';
    fs.writeFileSync(MEDICINES_CSV_PATH, lines.join('\n'));
  }
}

if (!fs.existsSync(USERS_CSV_PATH)) {
  fs.writeFileSync(USERS_CSV_PATH, 'phone,name,email,address,state,city,userType,isVerified\n');
  console.log('Created new users.csv file with headers');
}

if (!fs.existsSync(PHARMACISTS_CSV_PATH)) {
  fs.writeFileSync(PHARMACISTS_CSV_PATH, 'phone,name,email\n');
  console.log('Created new pharmacists.csv file with headers');
}

if (!fs.existsSync(PROFESSIONALS_CSV_PATH)) {
  fs.writeFileSync(PROFESSIONALS_CSV_PATH, 'name,passwordHash,role,email,phone\n');
  console.log('Created new professionals.csv file with headers');
}

// Store OTPs in memory (in production, use a database)
const otpStore = {};

// Authentication middleware
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      }
      
      req.user = user;
      next();
    });
  } else {
    res.status(401).json({ error: 'Authorization header required' });
  }
};

// user authentication and Registration Endpoints


app.post('/api/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone || !/^\d{10}$/.test(phone)) {
      return res.status(400).json({ error: 'Valid 10-digit phone number is required' });
    }
    
   
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
   
    otpStore[phone] = {
      otp,
      expiry: Date.now() + 5 * 60 * 1000 
    };
    
    
    
    console.log(`OTP for ${phone}: ${otp}`);
    
    res.status(200).json({ success: true, message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});


app.post('/api/verify-otp', async (req, res) => {
  try {
    const { phone, otp, name, state, city, userType } = req.body;
    
    // Check if we have an OTP for this number
    if (!otpStore[phone] || otpStore[phone].expiry < Date.now()) {
      return res.status(400).json({ error: 'OTP expired or invalid' });
    }
    
    // Verify OTP
    if (otpStore[phone].otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }
    
    // Check if user exists
    let userExists = false;
    const users = [];
    
    // Read existing users
    await new Promise((resolve, reject) => {
      fs.createReadStream(USERS_CSV_PATH)
        .pipe(csv())
        .on('data', (data) => {
          users.push(data);
          if (data.phone === phone) {
            userExists = true;
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });
    
    // If userType is pharmacist, check if phone is in pharmacists.csv
    if (userType === 'pharmacist') {
      let isPharmacistRegistered = false;
      await new Promise((resolve, reject) => {
        fs.createReadStream(PHARMACISTS_CSV_PATH)
          .pipe(csv())
          .on('data', (data) => {
            if (data.phone === phone) isPharmacistRegistered = true;
          })
          .on('end', resolve)
          .on('error', reject);
      });
      if (!isPharmacistRegistered) {
        return res.status(403).json({ error: 'Phone number not registered as pharmacist' });
      }
    }
    
    // Create or update user
    if (!userExists) {
      // New user registration
      const csvWriter = createObjectCsvWriter({
        path: USERS_CSV_PATH,
        header: [
          { id: 'phone', title: 'phone' },
          { id: 'name', title: 'name' },
          { id: 'state', title: 'state' },
          { id: 'city', title: 'city' },
          { id: 'userType', title: 'userType' },
          { id: 'isVerified', title: 'isVerified' }
        ],
        append: true
      });
      
      await csvWriter.writeRecords([{ 
        phone,
        name,
        state,
        city,
        userType,
        isVerified: 'true'
      }]);
    } else {
      // Update existing user if new data provided
      if (name && state && city && userType) {
        // Filter out the user to update
        const updatedUsers = users.filter(user => user.phone !== phone);
        
        // Add updated user
        updatedUsers.push({
          phone,
          name,
          state,
          city,
          userType,
          isVerified: 'true'
        });
        
        // Write all users back to CSV
        const csvWriter = createObjectCsvWriter({
          path: USERS_CSV_PATH,
          header: [
            { id: 'phone', title: 'phone' },
            { id: 'name', title: 'name' },
            { id: 'state', title: 'state' },
            { id: 'city', title: 'city' },
            { id: 'userType', title: 'userType' },
            { id: 'isVerified', title: 'isVerified' }
          ]
        });
        
        await csvWriter.writeRecords(updatedUsers);
      }
    }
    
    // Delete OTP from store
    delete otpStore[phone];
    
    // Generate JWT token
    const token = jwt.sign({ phone }, JWT_SECRET, { expiresIn: '7d' });
    
    // Return user data and token
    const userData = userExists
      ? users.find(user => user.phone === phone)
      : { phone, name, state, city, userType, isVerified: 'true' };
    
    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      token,
      user: userData
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// Get user profile
app.get('/api/user/profile', authenticateJWT, async (req, res) => {
  try {
    const { phone } = req.user;
    let userData = null;

    // Read users from CSV
    await new Promise((resolve, reject) => {
      fs.createReadStream(USERS_CSV_PATH)
        .pipe(csv())
        .on('data', (data) => {
          if (data.phone === phone) {
            userData = data;
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    if (!userData) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json(userData);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Update user profile
app.put('/api/user/profile', authenticateJWT, async (req, res) => {
  try {
    const { phone } = req.user;
    const { name, email, address, state, city } = req.body;

    // Read all users
    const users = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(USERS_CSV_PATH)
        .pipe(csv())
        .on('data', (data) => users.push(data))
        .on('end', resolve)
        .on('error', reject);
    });

    // Find and update user
    const userIndex = users.findIndex(user => user.phone === phone);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update user data (excluding phone number)
    users[userIndex] = {
      ...users[userIndex],
      name: name || users[userIndex].name,
      email: email || users[userIndex].email,
      address: address || users[userIndex].address,
      state: state || users[userIndex].state,
      city: city || users[userIndex].city,
      // Keep the original phone number
      phone: users[userIndex].phone
    };

    // Write updated users back to CSV
    const csvWriter = createObjectCsvWriter({
      path: USERS_CSV_PATH,
      header: [
        { id: 'phone', title: 'phone' },
        { id: 'name', title: 'name' },
        { id: 'email', title: 'email' },
        { id: 'address', title: 'address' },
        { id: 'state', title: 'state' },
        { id: 'city', title: 'city' },
        { id: 'userType', title: 'userType' },
        { id: 'isVerified', title: 'isVerified' }
      ]
    });

    await csvWriter.writeRecords(users);

    res.status(200).json(users[userIndex]);
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

// Pharmacist role check (for demo: phone '9999999999' is pharmacist)
function isPharmacist(req) {
  return req.user && req.user.role === 'professional';
}

// Get all medicine listings (only approved for public)
app.get('/api/medicines', (req, res) => {
  const results = [];
  fs.createReadStream(MEDICINES_CSV_PATH)
    .pipe(csv())
    .on('data', (data) => {
      if (data.status === 'approved') {
        if (data.image) {
          data.image = `/images/medicines/${data.image.trim()}`;
        }
        results.push(data);
      }
    })
    .on('end', () => {
      res.json(results);
    })
    .on('error', (error) => {
      res.status(500).json({ error: 'Failed to read medicines data' });
    });
});

// Add a new medicine listing with image upload (protected route)
app.post('/api/medicines', upload.single('image'), async (req, res) => {
  try {
    const { name, expiry, condition, price = '0' } = req.body;
    // Validate required fields
    if (!name || !expiry || !condition || !req.file) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'Missing required fields' });
    }
    // Add timestamp and unique id
    const timestamp = new Date().toISOString();
    const id = crypto.randomBytes(8).toString('hex');
    const imageName = req.file.filename;
    // Define CSV writer
    const csvWriter = createObjectCsvWriter({
      path: MEDICINES_CSV_PATH,
      header: [
        { id: 'id', title: 'id' },
        { id: 'name', title: 'name' },
        { id: 'expiry', title: 'expiry' },
        { id: 'condition', title: 'condition' },
        { id: 'price', title: 'price' },
        { id: 'timestamp', title: 'timestamp' },
        { id: 'image', title: 'image' },
        { id: 'status', title: 'status' }
      ],
      append: true
    });
    await csvWriter.writeRecords([{ 
      id,
      name, 
      expiry, 
      condition, 
      price, 
      timestamp,
      image: imageName,
      status: 'pending'
    }]);
    res.status(201).json({ 
      success: true,
      message: 'Medicine added successfully, pending pharmacist approval',
      medicine: { 
        id,
        name, 
        expiry, 
        condition, 
        price, 
        timestamp,
        image: `/images/medicines/${imageName}`,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('Error adding medicine:', error);
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch (unlinkError) {}
    }
    res.status(500).json({ error: 'Failed to add medicine' });
  }
});

// Pharmacist: Get all pending listings
app.get('/api/medicines/pending', authenticateJWT, (req, res) => {
  if (!isPharmacist(req)) return res.status(403).json({ error: 'Forbidden' });
  const results = [];
  fs.createReadStream(MEDICINES_CSV_PATH)
    .pipe(csv())
    .on('data', (data) => {
      if (data.status === 'pending') {
        if (data.image) {
          data.image = `/images/medicines/${data.image.trim()}`;
        }
        results.push(data);
      }
    })
    .on('end', () => {
      res.json(results);
    })
    .on('error', (error) => {
      res.status(500).json({ error: 'Failed to read medicines data' });
    });
});

// Pharmacist: Approve a listing
app.post('/api/medicines/:id/approve', authenticateJWT, async (req, res) => {
  if (!isPharmacist(req)) return res.status(403).json({ error: 'Forbidden' });
  const { id } = req.params;
  const medicines = [];
  let found = false;
  await new Promise((resolve, reject) => {
    fs.createReadStream(MEDICINES_CSV_PATH)
      .pipe(csv())
      .on('data', (data) => medicines.push(data))
      .on('end', resolve)
      .on('error', reject);
  });
  for (let med of medicines) {
    if (med.id === id) {
      med.status = 'approved';
      found = true;
    }
  }
  if (!found) return res.status(404).json({ error: 'Listing not found' });
  const csvWriter = createObjectCsvWriter({
    path: MEDICINES_CSV_PATH,
    header: [
      { id: 'id', title: 'id' },
      { id: 'name', title: 'name' },
      { id: 'expiry', title: 'expiry' },
      { id: 'condition', title: 'condition' },
      { id: 'price', title: 'price' },
      { id: 'timestamp', title: 'timestamp' },
      { id: 'image', title: 'image' },
      { id: 'status', title: 'status' }
    ]
  });
  await csvWriter.writeRecords(medicines);
  res.json({ success: true });
});

// Pharmacist: Reject a listing
app.post('/api/medicines/:id/reject', authenticateJWT, async (req, res) => {
  if (!isPharmacist(req)) return res.status(403).json({ error: 'Forbidden' });
  const { id } = req.params;
  const medicines = [];
  let found = false;
  await new Promise((resolve, reject) => {
    fs.createReadStream(MEDICINES_CSV_PATH)
      .pipe(csv())
      .on('data', (data) => medicines.push(data))
      .on('end', resolve)
      .on('error', reject);
  });
  for (let med of medicines) {
    if (med.id === id) {
      med.status = 'rejected';
      found = true;
    }
  }
  if (!found) return res.status(404).json({ error: 'Listing not found' });
  const csvWriter = createObjectCsvWriter({
    path: MEDICINES_CSV_PATH,
    header: [
      { id: 'id', title: 'id' },
      { id: 'name', title: 'name' },
      { id: 'expiry', title: 'expiry' },
      { id: 'condition', title: 'condition' },
      { id: 'price', title: 'price' },
      { id: 'timestamp', title: 'timestamp' },
      { id: 'image', title: 'image' },
      { id: 'status', title: 'status' }
    ]
  });
  await csvWriter.writeRecords(medicines);
  res.json({ success: true });
});

// Professional login endpoint
app.post('/api/professional-login', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (name !== 'Dr Doon' || password !== 'doctorLink') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // Generate JWT
    const token = jwt.sign({ name: 'Dr Doon', role: 'professional' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        name: 'Dr Doon',
        role: 'professional'
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Feedback endpoint
app.post('/api/feedback', async (req, res) => {
  try {
    const { name, email, feedback } = req.body;
    if (!name || !email || !feedback) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // If file doesn't exist, add header
    if (!fs.existsSync(FEEDBACK_CSV_PATH)) {
      fs.writeFileSync(FEEDBACK_CSV_PATH, 'name,email,feedback,timestamp\n');
    }

    // Append feedback and timestamp
    fs.appendFileSync(FEEDBACK_CSV_PATH, `${name},${email},${feedback},${new Date().toISOString()}\n`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving feedback:', error);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// Newsletter subscription endpoint
app.post('/api/newsletter', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    // If file doesn't exist, add header
    if (!fs.existsSync(NEWSLETTER_CSV_PATH)) {
      fs.writeFileSync(NEWSLETTER_CSV_PATH, 'email,timestamp\n');
    }

    // Append email and timestamp
    fs.appendFileSync(NEWSLETTER_CSV_PATH, `${email},${new Date().toISOString()}\n`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving newsletter subscription:', error);
    res.status(500).json({ error: 'Failed to save email' });
  }
});

// Serve static pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../Frontend/index.html'));
});

app.get('/browse', (req, res) => {
  res.sendFile(path.join(__dirname, '../Frontend/browse-medicines.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../Frontend/login.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`API endpoints:`);
  console.log(`- GET /api/medicines: Get all medicines`);
  console.log(`- POST /api/medicines: Add a new medicine`);
  console.log(`- POST /api/send-otp: Send OTP to phone number`);
  console.log(`- POST /api/verify-otp: Verify OTP and register/login user`);
  console.log(`- GET /api/user/profile: Get user profile (protected)`);
  console.log(`- PUT /api/user/profile: Update user profile (protected)`);
  console.log(`- GET /api/medicines/pending: Get all pending listings (protected)`);
  console.log(`- POST /api/medicines/:id/approve: Approve a listing (protected)`);
  console.log(`- POST /api/medicines/:id/reject: Reject a listing (protected)`);
  console.log(`- POST /api/professional-login: Professional login`);
  console.log(`- POST /api/feedback: Submit feedback`);
  console.log(`- POST /api/newsletter: Subscribe to newsletter`);
}); 