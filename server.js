// server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const natural = require('natural');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const PORT = 3000;

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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
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

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// Function to Extract Keywords
function extractKeywords(text) {
  const tokenizer = new natural.WordTokenizer();
  const stopwords = new Set(natural.stopwords);
  const words = tokenizer.tokenize(text.toLowerCase());

  const keywords = words.filter(word => !stopwords.has(word) && word.length > 2);

  console.log(`Extracted Keywords: ${keywords}`);
  return keywords;
}

// Function to Recommend Tourist Spots
async function recommendSpots() {
  try {
    // Get journal entries with descriptions
    const [entries] =  await pool.execute('SELECT entry_description FROM entries');
    
    let recommendations = [];

    for (const entry of entries) {
      const { entry_description } = entry;

      console.log(`Processing Entry: "${entry_description}"`);

      // Analyze Sentiment
      const sentimentResult = await analyzeSentiment(entry_description);

      // Only recommend if sentiment is positive
      if (sentimentResult.sentiment !== 'positive') {
        console.log('Skipping entry due to non-positive sentiment.');
        continue;
      }

      // Extract Keywords from Journal Entry
      const entryKeywords = extractKeywords(entry_description);

      const [locations] =  await pool.execute('SELECT location_place, location_name, location_description FROM locations');

      // Match Locations based on Keywords
      locations.forEach(location => {
        const locationKeywords = extractKeywords(location.location_description);
        const matchScore = entryKeywords.filter(word => locationKeywords.includes(word)).length;

        if (matchScore > 0) {
          console.log(`Match Found! Location: ${location.location_name}, Score: ${matchScore}`);

          recommendations.push({
            location_name: location.location_name,
            location_place: location.location_place,
            match_score: matchScore,
            sentiment: sentimentResult.sentiment,
            positive_percentage: sentimentResult.positive_percentage
          });
        }
      });
    }

    // Sort by match score (higher score = better match)
    recommendations.sort((a, b) => b.match_score - a.match_score);

    console.log('Final Recommendations:', recommendations);

    return recommendations;
  } catch (error) {
    console.error('Error:', error);
    return [];
  }
}

recommendSpots().then(recommendations => {
  console.log('Recommended Places:', recommendations);
});

// API Endpoints

// Fetch recommendations
app.get('/api/recommendations', async (req, res) => {
  try {
    const recommendations = await recommendSpots();
    res.status(200).json(recommendations);
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    res.status(500).json({ 
      message: 'Error fetching recommendations', 
      error: error.message 
    });
  }
});

// Create a new journal
app.post('/api/journals', async (req, res) => {
  try {
    const { journal_title, journal_date } = req.body;

    if (!journal_title || !journal_date) {
      return res.status(400).json({ message: 'Journal title and date are required' });
    }

    const [result] = await pool.execute(
      'INSERT INTO journals (journal_title, journal_date) VALUES (?, ?)',
      [journal_title, journal_date]
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
app.get('/api/journals', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM journals');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching journals:', error);
    res.status(500).json({ message: 'Error fetching journals', error: error.message });
  }
});

app.post('/api/entries', upload.array('entry_images', 5), async (req, res) => {
  try {
    const {
      journal_id,
      entry_description,
      entry_datetime,
      entry_location,
      entry_location_name
    } = req.body;

    if (!journal_id || !entry_description || !entry_datetime) {
      if (req.files) {
        await Promise.all(req.files.map(file => fs.unlink(file.path)));
      }
      return res.status(400).json({
        message: 'Journal ID, description, and datetime are required'
      });
    }

    // Ensure all values are properly defined
    const location = entry_location ?? null;
    const location_name = entry_location_name ?? null;

    // Analyze sentiment safely
    const sentimentAnalysis = analyzeSentiment(entry_description) || {};
    const sentiment = sentimentAnalysis.sentiment ?? 'neutral';
    const positive_percentage = sentimentAnalysis.positive_percentage ?? 0;
    const negative_percentage = sentimentAnalysis.negative_percentage ?? 0;
    const neutral_percentage = sentimentAnalysis.neutral_percentage ?? 0;

    // Handle uploaded files safely
    const entry_images = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];

    const [result] = await pool.execute(
      `INSERT INTO entries 
       (journal_id, entry_description, entry_datetime, sentiment,
        entry_location, entry_location_name, entry_images,
        positive_percentage, negative_percentage, neutral_percentage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

      [
        journal_id,
        entry_description,
        entry_datetime,
        sentiment,
        location,          // Ensuring it's not undefined
        location_name,     // Ensuring it's not undefined
        JSON.stringify(entry_images), // Ensure it's a valid JSON string
        positive_percentage,
        negative_percentage,
        neutral_percentage
      ]
    );

    res.status(201).json({
      message: 'Entry created successfully',
      entry_id: result.insertId,
      sentiment,
      positive_percentage,
      negative_percentage,
      neutral_percentage,
      entry_images
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
app.get('/api/entries/:journalId', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM entries WHERE journal_id = ?',
      [req.params.journalId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching entries:', error);
    res.status(500).json({ message: 'Error fetching entries', error: error.message });
  }
});

// Update a journal
app.put('/api/journals/:journalId', async (req, res) => {
  try {
    const { journalId } = req.params;
    const { journal_title, journal_date } = req.body;

    await pool.execute(
      'UPDATE journals SET journal_title = ?, journal_date = ? WHERE journal_id = ?',
      [journal_title, journal_date, journalId]
    );

    res.json({ message: 'Journal updated successfully' });
  } catch (error) {
    console.error('Error updating journal:', error);
    res.status(500).json({ message: 'Error updating journal', error: error.message });
  }
});

// Delete a journal
app.delete('/api/journals/:journalId', async (req, res) => {
  try {
    const { journalId } = req.params;

    await pool.execute('DELETE FROM journals WHERE journal_id = ?', [journalId]);
    res.json({ message: 'Journal deleted successfully' });
  } catch (error) {
    console.error('Error deleting journal:', error);
    res.status(500).json({ message: 'Error deleting journal', error: error.message });
  }
});

app.put('/api/entries/:entryId', upload.array('entry_images', 5), async (req, res) => {
  try {
    const { entryId } = req.params;
    const {
      journal_id,
      entry_description,
      entry_datetime,
      entry_location,
      entry_location_name,
      existing_images
    } = req.body;

    // Ensure required fields are not undefined
    if (!journal_id || !entry_description || !entry_datetime) {
      if (req.files) {
        await Promise.all(req.files.map(file => fs.unlink(file.path)));
      }
      return res.status(400).json({
        message: 'Journal ID, description, and datetime are required'
      });
    }

    const { sentiment, positive_percentage, negative_percentage, neutral_percentage } = analyzeSentiment(entry_description);

    // Handle existing images
    let entry_images = [];
    try {
      entry_images = existing_images ? JSON.parse(existing_images) : [];
    } catch (err) {
      console.error('Error parsing existing images:', err);
    }

    if (req.files) {
      const newImages = req.files.map(file => `/uploads/${file.filename}`);
      entry_images = [...entry_images, ...newImages];
    }

    // Log values before executing the query
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
      entryId
    });

    await pool.execute(
      `UPDATE entries SET
       journal_id = ?, entry_description = ?, entry_datetime = ?,
       sentiment = ?, entry_location = ?, entry_location_name = ?,
       entry_images = ?, positive_percentage = ?,
       negative_percentage = ?, neutral_percentage = ?
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
        entryId
      ]
    );

    res.json({
      message: 'Entry updated successfully',
      sentiment,
      positive_percentage,
      negative_percentage,
      neutral_percentage,
      entry_images
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
app.delete('/api/entries/:entryId', async (req, res) => {
  try {
    const { entryId } = req.params;

    await pool.execute('DELETE FROM entries WHERE entry_id = ?', [entryId]);
    res.json({ message: 'Entry deleted successfully' });
  } catch (error) {
    console.error('Error deleting entry:', error);
    res.status(500).json({ message: 'Error deleting entry', error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

module.exports = pool;
