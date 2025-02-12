// server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const natural = require('natural');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

// Database Connection
const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'djournal_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = db;


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Add timestamp to prevent filename collisions
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

// Initialize Express app
const app = express();
const PORT = 3000;

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
    const [entries] = await db.query('SELECT entry_description FROM entries');
    
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

      // Get Locations from Database
      const [locations] = await db.query('SELECT location_place, location_name, location_description FROM locations');

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

// Run Recommendation Function
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
app.post('/api/journals', (req, res) => {
  const { journal_title, journal_date } = req.body;

  if (!journal_title || !journal_date) {
    return res.status(400).json({ message: 'Journal title and date are required' });
  }

  const query = 'INSERT INTO journals (journal_title, journal_date) VALUES (?, ?)';
  db.query(query, [journal_title, journal_date], (err, results) => {
    if (err) {
      console.error('Error creating journal:', err);
      return res.status(500).json({ message: 'Error creating journal', error: err });
    }
    res.status(201).json({ message: 'Journal created successfully', journal_id: results.insertId });
  });
});

// Fetch all journals
app.get('/api/journals', (req, res) => {
  const query = 'SELECT * FROM journals';
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching journals:', err);
      return res.status(500).json({ message: 'Error fetching journals', error: err });
    }
    res.status(200).json(results);
  });
});

// Create a new entry
app.post('/api/entries', upload.array('entry_images', 5), async (req, res) => {
  try {
    const { journal_id, entry_description, entry_datetime, entry_location, entry_location_name } = req.body;

    if (!journal_id || !entry_description || !entry_datetime) {
      // Clean up uploaded files if validation fails
      if (req.files) {
        req.files.forEach(file => fs.unlinkSync(file.path));
      }
      return res.status(400).json({ message: 'Journal ID, description, and datetime are required' });
    }

    const { sentiment, positive_percentage, negative_percentage, neutral_percentage } = analyzeSentiment(entry_description);
    
    // Handle multiple images
    const entry_images = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];

    const query = `INSERT INTO entries 
                 (journal_id, entry_description, entry_datetime, sentiment, 
                  entry_location, entry_location_name, entry_images, 
                  positive_percentage, negative_percentage, neutral_percentage) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.query(query, [
      journal_id, 
      entry_description, 
      entry_datetime, 
      sentiment, 
      entry_location, 
      entry_location_name, 
      JSON.stringify(entry_images),
      positive_percentage, 
      negative_percentage, 
      neutral_percentage
    ], (err, result) => {
      if (err) {
        // Clean up uploaded files if database insert fails
        if (req.files) {
          req.files.forEach(file => fs.unlinkSync(file.path));
        }
        console.error('Error creating entry:', err);
        return res.status(500).json({ message: 'Error creating entry', error: err });
      }

      res.status(201).json({
        message: 'Entry created successfully',
        entry_id: result.insertId,
        sentiment,
        positive_percentage,
        negative_percentage,
        neutral_percentage,
        entry_images,
      });
    });
  } catch (error) {
    // Clean up uploaded files if any error occurs
    if (req.files) {
      req.files.forEach(file => fs.unlinkSync(file.path));
    }
    console.error('Error processing request:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// Fetch entries for a specific journal
app.get('/api/entries/:journalId', (req, res) => {
  const journalId = req.params.journalId;
  const query = 'SELECT * FROM entries WHERE journal_id = ?';

  db.query(query, [journalId], (err, results) => {
    if (err) {
      console.error('Error fetching entries:', err);
      return res.status(500).json({ message: 'Error fetching entries', error: err });
    }
    res.status(200).json(results);
  });
});

// Update a journal
app.put('/api/journals/:journalId', (req, res) => {
  const { journalId } = req.params;
  const { journal_title, journal_date } = req.body;
  const query = 'UPDATE journals SET journal_title = ?, journal_date = ? WHERE journal_id = ?';

  db.query(query, [journal_title, journal_date, journalId], (err, results) => {
    if (err) {
      console.error('Error updating journal:', err);
      return res.status(500).json({ message: 'Error updating journal', error: err });
    }
    res.status(200).json({ message: 'Journal updated successfully' });
  });
});

// Delete a journal
app.delete('/api/journals/:journalId', (req, res) => {
  const { journalId } = req.params;
  const query = 'DELETE FROM journals WHERE journal_id = ?';

  db.query(query, [journalId], (err, results) => {
    if (err) {
      console.error('Error deleting journal:', err);
      return res.status(500).json({ message: 'Error deleting journal', error: err });
    }
    res.status(200).json({ message: 'Journal deleted successfully' });
  });
});

// Update an entry
app.put('/api/entries/:entryId', upload.array('entry_images', 5), async (req, res) => {
  try {
    const { entryId } = req.params;
    const { journal_id, entry_description, entry_datetime, entry_location, entry_location_name, existing_images } = req.body;

    if (!journal_id || !entry_description || !entry_datetime) {
      if (req.files) {
        req.files.forEach(file => fs.unlinkSync(file.path));
      }
      return res.status(400).json({ message: 'Journal ID, description, and datetime are required' });
    }

    const { sentiment, positive_percentage, negative_percentage, neutral_percentage } = analyzeSentiment(entry_description);
    
    // Combine existing and new images
    let entry_images = [];
    if (existing_images) {
      entry_images = JSON.parse(existing_images);
    }
    if (req.files) {
      const newImages = req.files.map(file => `/uploads/${file.filename}`);
      entry_images = [...entry_images, ...newImages];
    }

    const query = `UPDATE entries SET 
                   journal_id = ?, 
                   entry_description = ?, 
                   entry_datetime = ?, 
                   sentiment = ?,
                   entry_location = ?, 
                   entry_location_name = ?, 
                   entry_images = ?,
                   positive_percentage = ?,
                   negative_percentage = ?,
                   neutral_percentage = ?
                   WHERE entry_id = ?`;

    db.query(query, [
      journal_id,
      entry_description,
      entry_datetime,
      sentiment,
      entry_location,
      entry_location_name,
      JSON.stringify(entry_images),
      positive_percentage,
      negative_percentage,
      neutral_percentage,
      entryId
    ], (err, result) => {
      if (err) {
        if (req.files) {
          req.files.forEach(file => fs.unlinkSync(file.path));
        }
        console.error('Error updating entry:', err);
        return res.status(500).json({ message: 'Error updating entry', error: err });
      }

      res.status(200).json({
        message: 'Entry updated successfully',
        sentiment,
        positive_percentage,
        negative_percentage,
        neutral_percentage,
        entry_images,
      });
    });
  } catch (error) {
    if (req.files) {
      req.files.forEach(file => fs.unlinkSync(file.path));
    }
    console.error('Error processing request:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// Delete an entry
app.delete('/api/entries/:entryId', (req, res) => {
  const { entryId } = req.params;

  const query = 'DELETE FROM entries WHERE entry_id = ?';

  db.query(query, [entryId], (err, results) => {
    if (err) {
      console.error('Error deleting entry:', err);
      return res.status(500).json({ message: 'Error deleting entry', error: err });
    }
    res.status(200).json({ message: 'Entry deleted successfully' });
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});