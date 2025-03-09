// server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const natural = require('natural');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 3000;

const JWT_SECRET = '5011d890dd189b61e74655c8e8262a29dd03efb0234f44218f41534906218ba9';

// Database Connection
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'djournal_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(bodyParser.urlencoded({ extended: true }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const isValidType = allowedTypes.test(file.mimetype);
    const isValidExt = allowedTypes.test(path.extname(file.originalname).toLowerCase());

    if (isValidType && isValidExt) {
      return cb(null, true);
    }
    cb(new Error('Only image files (jpeg, jpg, png, gif) are allowed'));
  },
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    const [existingUsers] = await pool.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({ message: 'User with this email already exists' });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert new user
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name, email, hashedPassword]
    );

    // Generate JWT token
    const token = jwt.sign(
      { user_id: result.insertId, email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      user_id: result.insertId,
      name,
      email,
      token
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ message: 'Error registering user', error: error.message });
  }
});

// User login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find user by email
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = users[0];

    // Compare passwords
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { user_id: user.user_id, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      user_id: user.user_id,
      name: user.name,
      email: user.email,
      token
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ message: 'Error logging in', error: error.message });
  }
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Profile picture upload endpoint
app.post('/api/user/upload-profile-picture', authenticateToken, upload.single('profile_picture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    // Get the relative path for storing in the database
    const relativePath = `/uploads/${req.file.filename}`;
    
    // Update the user's profile_picture in the database
    await pool.execute(
      'UPDATE users SET profile_picture = ? WHERE user_id = ?',
      [relativePath, req.user.user_id]
    );
    
    // Fetch the updated user profile
    const [users] = await pool.execute(
      'SELECT user_id, name, email, profile_picture FROM users WHERE user_id = ?',
      [req.user.user_id]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json(users[0]);
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    res.status(500).json({ message: 'Error uploading profile picture', error: error.message });
  }
});

// Also update your profile API endpoint to include the profile_picture field
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.execute(
      'SELECT user_id, name, email, profile_picture FROM users WHERE user_id = ?',
      [req.user.user_id]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json(users[0]);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: 'Error fetching user profile', error: error.message });
  }
});

app.get('/api/user/history', authenticateToken, async (req, res) => {
  try {
    const { userId, month, year } = req.query;
    
    if (!userId) {
      return res.status(400).json({ message: 'Missing user ID parameter' });
    }
    
    const requestedUserId = parseInt(userId);
    
    if (isNaN(requestedUserId)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    
    if (requestedUserId !== req.user.user_id) {
      return res.status(403).json({ 
        message: 'Unauthorized access to user data',
        requested: requestedUserId,
        authenticated: req.user.user_id 
      });
    }
    
    const startDate = `${year}-${month.padStart(2, '0')}-01`;
    const endDate = `${year}-${month.padStart(2, '0')}-31`;
    
    const [entries] = await pool.execute(
      `SELECT e.entry_id, e.journal_id, e.entry_description, e.entry_datetime, 
              e.entry_location, e.entry_location_name, e.entry_images,
              e.sentiment, e.positive_percentage, e.negative_percentage, e.neutral_percentage
       FROM entries e
       JOIN journals j ON e.journal_id = j.journal_id
       WHERE j.user_id = ? AND e.entry_datetime BETWEEN ? AND ?
       ORDER BY e.entry_datetime ASC`,
      [requestedUserId, startDate, endDate]
    );
    
    const processedEntries = await Promise.all(entries.map(async (entry) => {
      if (entry.sentiment === null || entry.positive_percentage === null) {
        const sentimentResult = analyzeSentiment(entry.entry_description);
        
        await pool.execute(
          `UPDATE entries SET 
            sentiment = ?, 
            positive_percentage = ?, 
            negative_percentage = ?, 
            neutral_percentage = ?
           WHERE entry_id = ?`,
          [
            sentimentResult.sentiment,
            sentimentResult.positive_percentage,
            sentimentResult.negative_percentage,
            sentimentResult.neutral_percentage,
            entry.entry_id
          ]
        );
        
        return {
          ...entry,
          sentiment: sentimentResult.sentiment,
          positive_percentage: sentimentResult.positive_percentage,
          negative_percentage: sentimentResult.negative_percentage,
          neutral_percentage: sentimentResult.neutral_percentage
        };
      }
      
      return entry;
    }));
    
    let totalPositive = 0;
    let totalNegative = 0;
    let totalNeutral = 0;
    
    processedEntries.forEach(entry => {
      totalPositive += entry.positive_percentage || 0;
      totalNegative += entry.negative_percentage || 0;
      totalNeutral += entry.neutral_percentage || 0;
    });
    
    const entryCount = processedEntries.length || 1;
    
    res.json({
      entries: processedEntries,
      summary: {
        totalEntries: entryCount,
        averageMood: {
          positive: totalPositive / entryCount,
          negative: totalNegative / entryCount,
          neutral: totalNeutral / entryCount
        }
      }
    });
    
  } catch (error) {
    console.error('Error fetching user history:', error);
    res.status(500).json({ message: 'Error fetching user history', error: error.message });
  }
});

// Function to analyze sentiment
function analyzeSentiment(text) {
  const analyzer = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'afinn');
  const tokenizer = new natural.WordTokenizer();

  const sentenceTokenizer = new natural.RegexpTokenizer({ pattern: /[\.!?\n]/ }); 
  let sentences = sentenceTokenizer.tokenize(text);  

  console.log('Text Tokenized into Sentences:', sentences);

  let sentenceResults = [];
  let positiveTotal = 0;
  let negativeTotal = 0;
  let neutralTotal = 0;
  let sentenceCount = 0;

  sentences.forEach((sentence) => {
    const tokens = tokenizer.tokenize(sentence);
    const score = Math.floor(analyzer.getSentiment(tokens) * 10) / 10;
    
    if(score == 0)
      neutralTotal += 1
    else if(score > 0)
      positiveTotal += 1
    else
      negativeTotal += 1

    const totalScore = positiveTotal + negativeTotal + neutralTotal;

    console.log(`Processing Sentence: "${sentence}"`);
    console.log('Tokenized:', tokens);
    console.log('Sentiment Score:', score);
    console.log('Positive Score:', positiveTotal);
    console.log('Negative Score:', negativeTotal);
    console.log('Neutral Score:', neutralTotal);
    console.log('Total Score:', totalScore);

    // Calculate percentages for the sentence
    const positivePercentage = ((positiveTotal / totalScore) * 100).toFixed(2);
    const negativePercentage = ((negativeTotal / totalScore) * 100).toFixed(2);
    const neutralPercentage = ((Math.abs(neutralTotal) / totalScore) * 100).toFixed(2);

    console.log(`Positive Percentage: ${positivePercentage}%`);
    console.log(`Negative Percentage: ${negativePercentage}%`);
    console.log(`Neutral Percentage: ${neutralPercentage}%`);

    const sentiment =
    positiveTotal > negativeTotal ? 'positive' : negativeTotal > positiveTotal ? 'negative' : 'neutral';

    console.log(`Sentiment: ${sentiment}`);

    sentenceResults.push({
      sentence: sentence,
      sentiment: sentiment,
      positive_percentage: Number(positivePercentage),
      negative_percentage: Number(negativePercentage),
      neutral_percentage: Number(neutralPercentage),
    });

    sentenceCount = totalScore;
  });

  // Calculate overall sentiment based on average score
  const overallPositivePercentage = ((positiveTotal / sentenceCount) * 100).toFixed(2);
  const overallNegativePercentage = ((negativeTotal / sentenceCount) * 100).toFixed(2);
  const overallNeutralPercentage = ((neutralTotal / sentenceCount) * 100).toFixed(2);

  console.log('Overall Sentiment Calculations:');
  console.log('Positive Total:', positiveTotal);
  console.log('Negative Total:', negativeTotal);
  console.log('Neutral Total:', neutralTotal);

  const overallSentiment =
    positiveTotal > negativeTotal
      ? 'positive'
      : negativeTotal > positiveTotal
      ? 'negative'
      : 'neutral';

  console.log('Overall Sentiment:', overallSentiment);
  console.log(`Overall Positive Percentage: ${overallPositivePercentage}%`);
  console.log(`Overall Negative Percentage: ${overallNegativePercentage}%`);
  console.log(`Overall Neutral Percentage: ${overallNeutralPercentage}%`);

  return {
    sentiment: overallSentiment,
    positive_percentage: Number(overallPositivePercentage),
    negative_percentage: Number(overallNegativePercentage),
    neutral_percentage: Number(overallNeutralPercentage),
  };
}

function extractKeywords(text) {
  const tokenizer = new natural.WordTokenizer();
  const stopwords = new Set(natural.stopwords);
  const words = tokenizer.tokenize(text.toLowerCase());

  const keywords = words.filter(word => !stopwords.has(word) && word.length > 2);

  console.log(`Extracted Keywords: ${keywords}`);
  return keywords;
}

async function recommendSpots(userId) {
  console.log("Recommending spots for user ID:", userId);
  try {
    const [entries] = await pool.execute(
      `SELECT e.entry_description, e.location_id, e.entry_location_name
       FROM entries e 
       JOIN journals j ON e.journal_id = j.journal_id 
       WHERE j.user_id = ?`,
      [userId]
    );
    
    const recommendationsObj = {};

    for (const entry of entries) {
      const { entry_description } = entry;
      console.log(`Processing Entry: "${entry_description}"`);

      const sentimentResult = analyzeSentiment(entry_description);

      if (sentimentResult.sentiment !== 'positive') {
        console.log('Skipping entry due to non-positive sentiment.');
        continue;
      }

      const entryKeywords = extractKeywords(entry_description);

      const [locations] = await pool.execute(
        'SELECT location_id, location_place, location_name, location_description, location_images, user_submitted_images, overall_positive, overall_negative, overall_neutral FROM locations'
      );

      locations.forEach(location => {
        const locationKeywords = extractKeywords(location.location_description);
        const matchScore = entryKeywords.filter(word => locationKeywords.includes(word)).length;

        if (matchScore > 0) {
          const uniqueKey = `${location.location_name}|${location.location_place}`.toLowerCase();
          
          let processedImages = null;
          let processedUserImages = null;
          
          if (location.location_images) {
            try {
              const parsedImages = JSON.parse(location.location_images);
              processedImages = Array.isArray(parsedImages) && parsedImages.length > 0 
                ? parsedImages[0]
                : parsedImages;
            } catch (e) {
              console.log(`Could not parse location_images for ${location.location_name}`, e);
              processedImages = location.location_images;
            }
          }
          
          if (location.user_submitted_images) {
            try {
              const parsedUserImages = JSON.parse(location.user_submitted_images);
              processedUserImages = Array.isArray(parsedUserImages) && parsedUserImages.length > 0 
                ? parsedUserImages 
                : parsedUserImages; 
            } catch (e) {
              console.log(`Could not parse user_submitted_images for ${location.location_name}`, e);
              processedUserImages = location.user_submitted_images;
            }
          }
          
          if (!recommendationsObj[uniqueKey] || recommendationsObj[uniqueKey].match_score < matchScore) {
            recommendationsObj[uniqueKey] = {
              location_id: location.location_id,
              location_name: location.location_name,
              location_place: location.location_place,
              location_description: location.location_description,
              location_images: processedImages,
              user_submitted_images: processedUserImages,
              overall_positive: location.overall_positive,
              overall_negative: location.overall_negative,
              overall_neutral: location.overall_neutral,
              match_score: matchScore,
              sentiment: sentimentResult.sentiment,
              positive_percentage: sentimentResult.positive_percentage
            };
          }
        }
      });
    }

    const recommendations = Object.values(recommendationsObj)
      .sort((a, b) => {
        const scoreComparison = b.match_score - a.match_score;
        if (scoreComparison !== 0) return scoreComparison;
        
        return a.location_name.localeCompare(b.location_name);
      });

    console.log('Final Recommendations:', recommendations);
    return recommendations;
  } catch (error) {
    console.error('Error:', error);
    return [];
  }
}

async function associateEntryImagesWithLocation(entryId) {
  try {
    console.log(`Processing entry ${entryId} for image association`);
    
    const [entryRows] = await pool.execute(
      `SELECT entry_images, location_id, display_images_in_recommendation 
       FROM entries 
       WHERE entry_id = ?`,
      [entryId]
    );
    
    if (entryRows.length === 0) {
      console.log(`Entry not found: ${entryId}`);
      return false;
    }
    
    const entry = entryRows[0];
    
    console.log(`Entry data:`, {
      entryId,
      locationId: entry.location_id,
      displayImagesInRecommendation: entry.display_images_in_recommendation,
      displayImagesType: typeof entry.display_images_in_recommendation
    });
    
    if (!entry.location_id) {
      console.log(`No location associated with entry ${entryId}`);
      return true;
    }
    
    const isPrivate = !entry.display_images_in_recommendation || 
                      entry.display_images_in_recommendation === 0 || 
                      entry.display_images_in_recommendation === '0' || 
                      entry.display_images_in_recommendation === 'false' || 
                      entry.display_images_in_recommendation === false;
    
    console.log(`Privacy setting for entry ${entryId}: ${isPrivate ? 'Private' : 'Public'}`);
    
    const [locationRows] = await pool.execute(
      'SELECT user_submitted_images FROM locations WHERE location_id = ?',
      [entry.location_id]
    );
    
    if (locationRows.length === 0) {
      console.log(`Location not found: ${entry.location_id}`);
      return false;
    }
    
    let userSubmittedImages = [];
    if (locationRows[0].user_submitted_images && locationRows[0].user_submitted_images !== 'null') {
      try {
        userSubmittedImages = JSON.parse(locationRows[0].user_submitted_images);
        console.log(`Found ${userSubmittedImages.length} existing images for location ${entry.location_id}`);
      } catch (e) {
        console.error(`Error parsing existing user_submitted_images for location ${entry.location_id}:`, e);
        userSubmittedImages = [];
      }
    }
    
    const previousCount = userSubmittedImages.length;
    userSubmittedImages = userSubmittedImages.filter(img => 
      img.entry_id !== entryId && 
      img.entry_id !== parseInt(entryId)
    );
    
    console.log(`Removed ${previousCount - userSubmittedImages.length} existing images from entry ${entryId}`);
    
    if (isPrivate) {
      console.log(`Privacy setting is private for entry ${entryId}. Not adding images to location ${entry.location_id}`);
      
      await pool.execute(
        'UPDATE locations SET user_submitted_images = ? WHERE location_id = ?',
        [JSON.stringify(userSubmittedImages), entry.location_id]
      );
      
      console.log(`Successfully removed images for private entry ${entryId}`);
      return true;
    }
    
    let entryImages = [];
    if (entry.entry_images && entry.entry_images !== 'null') {
      try {
        if (typeof entry.entry_images === 'string') {
          entryImages = JSON.parse(entry.entry_images);
        } else {
          entryImages = entry.entry_images;
        }
        
        console.log(`Found ${entryImages.length} images to add from entry ${entryId}`);
      } catch (e) {
        console.error(`Error parsing entry images for entry ${entryId}:`, e);
        return false;
      }
    }
    
    if (entryImages.length > 0) {
      const newImages = entryImages.map(image => ({
        image_url: image,
        entry_id: entryId
      }));
      
      userSubmittedImages = [...userSubmittedImages, ...newImages];
      
      console.log(`Added ${newImages.length} images from entry ${entryId} to location ${entry.location_id}`);
    }
    
    await pool.execute(
      'UPDATE locations SET user_submitted_images = ? WHERE location_id = ?',
      [JSON.stringify(userSubmittedImages), entry.location_id]
    );
    
    console.log(`Successfully processed images for entry ${entryId} with location ${entry.location_id}`);
    return true;
    
  } catch (error) {
    console.error('Error associating entry images with location:', error);
    return false;
  }
}

// API Endpoints

app.get('/api/recommendations', authenticateToken, async (req, res) => {
    console.log("User ID from token:", req.user?.user_id);

  try {
    const userId = req.user.user_id;
    const recommendations = await recommendSpots(userId);
    res.status(200).json(recommendations);
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    res.status(500).json({ 
      message: 'Error fetching recommendations', 
      error: error.message 
    });
  }
});

app.get('/api/locations', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT location_id, location_place, location_name, location_description, location_images, latitude, longitude FROM locations'
    );
    
    const processedRows = rows.map(row => {
      if (row.location_images) {
        try {
          const parsedImages = JSON.parse(row.location_images);
          row.location_images = Array.isArray(parsedImages) && parsedImages.length > 0 
            ? parsedImages[0] 
            : null;
        } catch(e) {
          console.log(`Could not parse location_images for ${row.location_name}`, e);
        }
      }
      return row;
    });
    
    res.json(processedRows);
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ message: 'Error fetching locations', error: error.message });
  }
});

// Create a new journal
app.post('/api/journals', authenticateToken, async (req, res) => {
  try {
    const { journal_title, journal_date } = req.body;
    const userId = req.user.user_id;

    if (!journal_title || !journal_date) {
      return res.status(400).json({ message: 'Journal title and date are required' });
    }

    const [result] = await pool.execute(
      'INSERT INTO journals (journal_title, journal_date, user_id) VALUES (?, ?, ?)',
      [journal_title, journal_date, userId]
    );

    res.status(201).json({
      message: 'Journal created successfully',
      journal_id: result.insertId
    });
  } catch (error) {
    console.error('Error creating journal:', error);
    res.status(500).json({ message: 'Error creating journal', error: error.message });
  }
});

// Fetch all journals
app.get('/api/journals', authenticateToken, async (req, res) => {
  
  try {
    const userId = req.user.user_id;
    const [rows] = await pool.execute(
      'SELECT * FROM journals WHERE user_id = ?',
      [userId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching journals:', error);
    res.status(500).json({ message: 'Error fetching journals', error: error.message });
  }
});

// Create entry
app.post('/api/entries', authenticateToken, upload.array('entry_images', 5), async (req, res) => {
  try {
    const {
      journal_id,
      entry_description,
      entry_datetime,
      entry_location,
      entry_location_name,
      location_id,
      display_images_in_recommendation
    } = req.body;
    
    const userId = req.user.user_id;

    if (!journal_id || !entry_description || !entry_datetime) {
      if (req.files) {
        await Promise.all(req.files.map(file => fs.unlink(file.path)));
      }
      return res.status(400).json({
        message: 'Journal ID, description, and datetime are required'
      });
    }

    const [journals] = await pool.execute(
      'SELECT journal_id FROM journals WHERE journal_id = ? AND user_id = ?',
      [journal_id, userId]
    );

    if (journals.length === 0) {
      if (req.files) {
        await Promise.all(req.files.map(file => fs.unlink(file.path)));
      }
      return res.status(403).json({ message: 'Not authorized to add entries to this journal' });
    }

    const location = entry_location ?? null;
    const location_name = entry_location_name ?? null;
    
    const shouldDisplayImages = display_images_in_recommendation === undefined ? 
      true :
      (display_images_in_recommendation === 'false' ? false : Boolean(display_images_in_recommendation));
    
    const sentimentAnalysis = analyzeSentiment(entry_description) || {};
    const sentiment = sentimentAnalysis.sentiment ?? 'neutral';
    const positive_percentage = sentimentAnalysis.positive_percentage ?? 0;
    const negative_percentage = sentimentAnalysis.negative_percentage ?? 0;
    const neutral_percentage = sentimentAnalysis.neutral_percentage ?? 0;

    const entry_images = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];

    const [result] = await pool.execute(
      `INSERT INTO entries 
         (journal_id, entry_description, entry_datetime, sentiment,
          entry_location, entry_location_name, entry_images,
          positive_percentage, negative_percentage, neutral_percentage,
          location_id, display_images_in_recommendation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        journal_id,
        entry_description,
        entry_datetime,
        sentiment,
        location,          
        location_name,    
        JSON.stringify(entry_images), 
        positive_percentage,
        negative_percentage,
        neutral_percentage,
        location_id || null,
        shouldDisplayImages
      ]
    );

    if (location_id && shouldDisplayImages && entry_images.length > 0) {
      await associateEntryImagesWithLocation(result.insertId);
    }

    res.status(201).json({
      message: 'Entry created successfully',
      entry_id: result.insertId,
      sentiment,
      positive_percentage,
      negative_percentage,
      neutral_percentage,
      entry_images,
      location_id: location_id || null,
      display_images_in_recommendation: shouldDisplayImages
    });
  } catch (error) {
    if (req.files) {
      await Promise.all(req.files.map(file => fs.unlink(file.path)));
    }
    console.error('Error creating entry:', error);
    res.status(500).json({ message: 'Error creating entry', error: error.message });
  }
});

// Fetch entries for a specific journal
app.get('/api/entries/:journalId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const journalId = req.params.journalId;
    
    const [journals] = await pool.execute(
      'SELECT journal_id FROM journals WHERE journal_id = ? AND user_id = ?',
      [journalId, userId]
    );
    
    if (journals.length === 0) {
      return res.status(403).json({ message: 'Not authorized to view this journal' });
    }
    
    const [rows] = await pool.execute(
      `SELECT entry_id, entry_description, entry_datetime, entry_images, 
       entry_location_name, sentiment, 
       positive_percentage, neutral_percentage, negative_percentage
       FROM entries WHERE journal_id = ?`,
      [journalId]
    );
    
    res.json({ data: rows });
  } catch (error) {
    console.error('🚨 Error fetching entries:', error);
    res.status(500).json({ message: 'Error fetching entries', error: error.message });
  }
});

// Update a journal
app.put('/api/journals/:journalId', authenticateToken, async (req, res) => {
  try {
    const { journalId } = req.params;
    const { journal_title, journal_date } = req.body;
    const userId = req.user.user_id;

    const [journals] = await pool.execute(
      'SELECT journal_id FROM journals WHERE journal_id = ? AND user_id = ?',
      [journalId, userId]
    );
    
    if (journals.length === 0) {
      return res.status(403).json({ message: 'Not authorized to update this journal' });
    }

    await pool.execute(
      'UPDATE journals SET journal_title = ?, journal_date = ? WHERE journal_id = ? AND user_id = ?',
      [journal_title, journal_date, journalId, userId]
    );

    res.json({ message: 'Journal updated successfully' });
  } catch (error) {
    console.error('Error updating journal:', error);
    res.status(500).json({ message: 'Error updating journal', error: error.message });
  }
});

// Delete a journal
app.delete('/api/journals/:journalId', authenticateToken, async (req, res) => {
  const { journalId } = req.params;
  const userId = req.user.user_id;
  const connection = await pool.getConnection();

  try {
    const [journals] = await connection.execute(
      'SELECT journal_id FROM journals WHERE journal_id = ?',
      [journalId]
    );
    
    if (journals.length === 0) {
      connection.release();
      return res.status(403).json({ message: 'Not authorized to delete this journal' });
    }
    
    await connection.beginTransaction();
    await connection.execute('DELETE FROM entries WHERE journal_id = ?', [journalId]);
    await connection.execute('DELETE FROM journals WHERE journal_id = ?', [journalId]);
    await connection.commit();

    res.json({ message: 'Journal and its related entries deleted successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Error deleting journal and its entries:', error);
    res.status(500).json({ message: 'Error deleting journal and its entries', error: error.message });
  } finally {
    connection.release();
  }
});

// Update an entry
app.put('/api/entries/:entryId', authenticateToken, upload.array('entry_images', 5), async (req, res) => {
  try {
    const { entryId } = req.params;
    const userId = req.user.user_id;
    const {
      journal_id,
      entry_description,
      entry_datetime,
      entry_location,
      entry_location_name,
      existing_images,
      location_id,
      display_images_in_recommendation
    } = req.body;

    const [entries] = await pool.execute(
      'SELECT e.entry_id, e.display_images_in_recommendation, e.location_id FROM entries e JOIN journals j ON e.journal_id = j.journal_id WHERE e.entry_id = ? AND j.user_id = ?',
      [entryId, userId]
    );
    
    if (entries.length === 0) {
      if (req.files) {
        await Promise.all(req.files.map(file => fs.unlink(file.path)));
      }
      return res.status(403).json({ message: 'Not authorized to update this entry' });
    }

    if (!journal_id || !entry_description || !entry_datetime) {
      if (req.files) {
        await Promise.all(req.files.map(file => fs.unlink(file.path)));
      }
      return res.status(400).json({
        message: 'Journal ID, description, and datetime are required'
      });
    }

    const [journals] = await pool.execute(
      'SELECT journal_id FROM journals WHERE journal_id = ? AND user_id = ?',
      [journal_id, userId]
    );
    
    if (journals.length === 0) {
      if (req.files) {
        await Promise.all(req.files.map(file => fs.unlink(file.path)));
      }
      return res.status(403).json({ message: 'Not authorized to use this journal' });
    }

    const { sentiment, positive_percentage, negative_percentage, neutral_percentage } = analyzeSentiment(entry_description);

    let entry_images = [];
    if (existing_images) {
      try {
        entry_images = JSON.parse(existing_images);
      } catch (err) {
        console.error('Error parsing existing images:', err);
      }
    } else {
      const [existingEntry] = await pool.execute(
        'SELECT entry_images FROM entries WHERE entry_id = ?',
        [entryId]
      );

      if (existingEntry.length > 0 && existingEntry[0].entry_images) {
        try {
          entry_images = JSON.parse(existingEntry[0].entry_images);
        } catch (err) {
          console.error('Error parsing existing entry images:', err);
        }
      }
    }

    if (req.files) {
      const newImages = req.files.map(file => `/uploads/${file.filename}`);
      entry_images = [...entry_images, ...newImages];
    }

    const previousDisplaySetting = entries[0].display_images_in_recommendation;
    const previousLocationId = entries[0].location_id;
    
    const shouldDisplayImages = display_images_in_recommendation === undefined ? 
      previousDisplaySetting : // Keep existing value if not provided
      (display_images_in_recommendation === 'false' ? false : Boolean(display_images_in_recommendation));

    console.log('Updating entry with values:', {
      journal_id,
      entry_description,
      entry_datetime,
      sentiment,
      entry_location: entry_location || null,
      entry_location_name: entry_location_name || null,
      entry_images: JSON.stringify(entry_images),
      positive_percentage,
      negative_percentage,
      neutral_percentage,
      location_id: location_id || null,
      display_images_in_recommendation: shouldDisplayImages,
      entryId,
    });

    await pool.execute(
      `UPDATE entries SET
       journal_id = ?, entry_description = ?, entry_datetime = ?,
       sentiment = ?, entry_location = ?, entry_location_name = ?,
       entry_images = ?, positive_percentage = ?,
       negative_percentage = ?, neutral_percentage = ?,
       location_id = ?, display_images_in_recommendation = ?
       WHERE entry_id = ?`,
      [
        journal_id,
        entry_description,
        entry_datetime,
        sentiment,
        entry_location || null,
        entry_location_name || null,
        JSON.stringify(entry_images),
        positive_percentage,
        negative_percentage,
        neutral_percentage,
        location_id || null,
        shouldDisplayImages,
        entryId,
      ]
    );

    const locationChanged = location_id !== previousLocationId;
    const displaySettingChanged = shouldDisplayImages !== previousDisplaySetting;
    
    if ((locationChanged || displaySettingChanged) && entry_images.length > 0) {
      if (location_id && shouldDisplayImages) {
        await associateEntryImagesWithLocation(entryId);
      }
    }

    res.json({
      message: 'Entry updated successfully',
      sentiment,
      positive_percentage,
      negative_percentage,
      neutral_percentage,
      entry_images,
      location_id: location_id || null,
      display_images_in_recommendation: shouldDisplayImages
    });
  } catch (error) {
    if (req.files) {
      await Promise.all(req.files.map(file => fs.unlink(file.path)));
    }
    console.error('Error updating entry:', error);
    res.status(500).json({ message: 'Error updating entry', error: error.message });
  }
});

// Delete an entry
app.delete('/api/entries/:entryId', authenticateToken, async (req, res) => {
  try {
    const { entryId } = req.params;
    const userId = req.user.user_id;

    const [entries] = await pool.execute(
      'SELECT entry_id FROM entries WHERE entry_id = ?',
      [entryId]
    );
    
    if (entries.length === 0) {
      return res.status(403).json({ message: 'Not authorized to delete this entry' });
    }

    await pool.execute('DELETE FROM entries WHERE entry_id = ?', [entryId]);
    res.json({ message: 'Entry deleted successfully' });
  } catch (error) {
    console.error('Error deleting entry:', error);
    res.status(500).json({ message: 'Error deleting entry', error: error.message });
  }
});

async function aggregateLocationSentiments() {
  try {
    console.log('Fetching entries with location data for all users...');
    const [entries] = await pool.execute(`
      SELECT 
        e.entry_id, 
        e.entry_location_name,
        e.location_id,
        e.positive_percentage, 
        e.negative_percentage, 
        e.neutral_percentage 
      FROM entries e
      WHERE (e.location_id IS NOT NULL) OR (e.entry_location_name IS NOT NULL AND e.entry_location_name != '')
    `);
    console.log(`Fetched ${entries.length} entries with location data.`);

    const [locations] = await pool.execute(`
      SELECT 
        location_id, 
        location_name,
        location_place
      FROM locations
    `);
    console.log(`Fetched ${locations.length} locations.`);

    const locationMap = {};
    locations.forEach(location => {
      locationMap[location.location_id] = location;
    });

    const locationSentiments = {};

    for (const entry of entries) {
      let locationKey;
      if (entry.location_id) {
        locationKey = entry.location_id;
      } else if (entry.entry_location_name) {
        locationKey = `name_${entry.entry_location_name.toLowerCase()}`;
      } else {
        continue;
      }

      if (!locationSentiments[locationKey]) {
        let locationName, locationPlace;
        
        if (entry.location_id && locationMap[entry.location_id]) {
          const location = locationMap[entry.location_id];
          locationName = location.location_name;
          locationPlace = location.location_place;
        } else if (entry.entry_location_name) {
          locationName = entry.entry_location_name;
          locationPlace = '';
        }
        
        locationSentiments[locationKey] = {
          location_id: entry.location_id || null,
          location_name: locationName,
          location_place: locationPlace,
          entries_count: 0,
          positive_percentages: [],
          negative_percentages: [],
          neutral_percentages: [],
          overall_positive: 0,
          overall_negative: 0,
          overall_neutral: 0
        };
      }
      
      locationSentiments[locationKey].entries_count += 1;
      locationSentiments[locationKey].positive_percentages.push(entry.positive_percentage);
      locationSentiments[locationKey].negative_percentages.push(entry.negative_percentage);
      locationSentiments[locationKey].neutral_percentages.push(entry.neutral_percentage);
    }

    console.log(`Aggregated data for ${Object.keys(locationSentiments).length} locations`);

    const result = Object.values(locationSentiments).map(location => {
      if (location.entries_count > 0) {
        location.overall_positive = parseFloat((
          location.positive_percentages.reduce((sum, val) => sum + val, 0) / 
          location.entries_count
        ).toFixed(2));

        location.overall_negative = parseFloat((
          location.negative_percentages.reduce((sum, val) => sum + val, 0) / 
          location.entries_count
        ).toFixed(2));

        location.overall_neutral = parseFloat((
          location.neutral_percentages.reduce((sum, val) => sum + val, 0) / 
          location.entries_count
        ).toFixed(2));
      }

      delete location.positive_percentages;
      delete location.negative_percentages;
      delete location.neutral_percentages;
      
      return location;
    }).sort((a, b) => b.entries_count - a.entries_count);

    return result;
  } catch (error) {
    console.error('Error aggregating location sentiments:', error);
    throw error;
  }
}

async function updateLocationSentiments() {
  try {
    console.log('Starting updateLocationSentiments for all users...');
    const locationSentiments = await aggregateLocationSentiments();
    const connection = await pool.getConnection();
    
    try {
      console.log('Starting database transaction...');
      await connection.beginTransaction();
      
      const [locationColumns] = await connection.execute(`
        SHOW COLUMNS FROM locations
      `);
      
      const columnNames = locationColumns.map(col => col.Field);
      const sentimentColumns = [
        'entries_count',
        'overall_positive',
        'overall_negative',
        'overall_neutral'
      ];
      
      const missingColumns = sentimentColumns.filter(col => !columnNames.includes(col));
      if (missingColumns.length > 0) {
        console.log(`Adding missing sentiment columns to locations table: ${missingColumns.join(', ')}`);
        
        for (const column of missingColumns) {
          await connection.execute(`
            ALTER TABLE locations
            ADD COLUMN ${column} FLOAT DEFAULT 0
          `);
        }
        console.log('Added missing columns to locations table');
      }
      
      const [tables] = await connection.execute(`
        SHOW TABLES LIKE 'location_sentiments'
      `);
      
      if (tables.length === 0) {
        console.log('Creating location_sentiments table...');
        await connection.execute(`
          CREATE TABLE location_sentiments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            location_id INT NOT NULL,
            entries_count INT DEFAULT 0,
            overall_positive FLOAT DEFAULT 0,
            overall_negative FLOAT DEFAULT 0,
            overall_neutral FLOAT DEFAULT 0,
            UNIQUE KEY location_id (location_id),
            FOREIGN KEY (location_id) REFERENCES locations(location_id) ON DELETE CASCADE
          )
        `);
      }
      
      console.log('Clearing existing sentiment data...');
      await connection.execute(`
        DELETE FROM location_sentiments
      `);
      
      console.log('Resetting sentiment data in locations table...');
      await connection.execute(`
        UPDATE locations
        SET 
          entries_count = 0,
          overall_positive = 0,
          overall_negative = 0,
          overall_neutral = 0
      `);
      
      console.log(`Inserting sentiment data for ${locationSentiments.length} locations...`);
      
      for (const location of locationSentiments) {
        if (!location.location_id) continue;
        
        await connection.execute(`
          INSERT INTO location_sentiments 
          (location_id, entries_count, overall_positive, overall_negative, overall_neutral)
          VALUES (?, ?, ?, ?, ?)
        `, [
          location.location_id,
          location.entries_count,
          location.overall_positive,
          location.overall_negative,
          location.overall_neutral
        ]);
        
        await connection.execute(`
          UPDATE locations
          SET 
            entries_count = ?,
            overall_positive = ?,
            overall_negative = ?,
            overall_neutral = ?
          WHERE location_id = ?
        `, [
          location.entries_count,
          location.overall_positive,
          location.overall_negative,
          location.overall_neutral,
          location.location_id
        ]);
        
        console.log(`Updated location sentiment for location ${location.location_name} (ID: ${location.location_id})`);
      }
      
      await connection.commit();
      console.log(`Updated sentiment data for ${locationSentiments.length} locations.`);
      return { 
        success: true, 
        locationsUpdated: locationSentiments.length,
        locationData: locationSentiments 
      };
    } catch (error) {
      await connection.rollback();
      console.error('Transaction rolled back due to error:', error);
      throw error;
    } finally {
      connection.release();
      console.log('Database connection released.');
    }
  } catch (error) {
    console.error('Error updating location sentiments:', error);
    throw error;
  }
}

app.get('/api/locations/sentiment', authenticateToken, async (req, res) => {
  try {
    console.log('API request received: GET /api/locations/sentiment');
    
    const locationSentiments = await aggregateLocationSentiments();
    
    console.log(`Returning sentiment data for ${locationSentiments.length} locations`);
    res.status(200).json(locationSentiments);
  } catch (error) {
    console.error('Error fetching location sentiments:', error);
    res.status(500).json({ 
      message: 'Error fetching location sentiments', 
      error: error.message 
    });
  }
});

app.post('/api/locations/update-sentiments', authenticateToken, async (req, res) => {
  try {
    console.log('API request received: POST /api/locations/update-sentiments');
    
    const result = await updateLocationSentiments();
    
    res.status(200).json({
      message: 'Location sentiment data updated successfully',
      locationsUpdated: result.locationsUpdated,
      success: true
    });
  } catch (error) {
    console.error('Error updating location sentiments:', error);
    res.status(500).json({ 
      message: 'Error updating location sentiments', 
      error: error.message 
    });
  }
});

async function scheduleLocationSentimentUpdates() {
  console.log('Running scheduled location sentiment updates...');
  
  try {
    await updateLocationSentiments()
      .then(result => console.log(`Sentiment update complete: ${result.locationsUpdated} locations updated`))
      .catch(err => console.error('Failed to update location sentiments:', err));
    
    console.log('Completed sentiment updates');
  } catch (error) {
    console.error('Error updating sentiments:', error);
  }
}

async function testLocationSentimentUpdate() {
  try {
    console.log('==== RUNNING IMMEDIATE TEST OF LOCATION SENTIMENT UPDATE ====');
    const result = await updateLocationSentiments();
    console.log('==== TEST RESULTS ====');
    console.log(`Locations updated: ${result.locationsUpdated}`);
    if (result.locationData && result.locationData.length > 0) {
      console.log('Sample of updated location data:');
      console.log(JSON.stringify(result.locationData.slice(0, 3), null, 2));
    }
    
    const [updatedLocations] = await pool.execute(`
      SELECT location_id, location_name, entries_count, 
             overall_positive, overall_negative, overall_neutral
      FROM locations
      WHERE entries_count > 0
      LIMIT 3
    `);
    
    console.log('Verification of locations table updates:');
    console.log(JSON.stringify(updatedLocations, null, 2));
    
    console.log('==== TEST COMPLETE ====');
    return result;
  } catch (error) {
    console.error('TEST FAILED:', error);
    throw error;
  }
}

function initializeScheduler() {
  console.log('Initializing scheduled location sentiment updates...');
  
  console.log('Running immediate test to verify location sentiment updates...');
  testLocationSentimentUpdate()
    .then(() => console.log('Immediate test completed successfully.'))
    .catch(err => console.error('Immediate test failed:', err));
  
  // Schedule to run daily at midnight
  const millisecondsInDay = 24 * 60 * 60 * 1000;
  setInterval(() => {
    const now = new Date();
    console.log(`Running scheduled location sentiment update at ${now.toISOString()}`);
    
    scheduleLocationSentimentUpdates()
      .catch(err => console.error('Failed to update location sentiments on schedule:', err));
  }, millisecondsInDay);
}

initializeScheduler();

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

module.exports = pool;