// server.js
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const cors = require('cors');
const natural = require('natural');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Database Connection
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'djournal_db',
});

db.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  }
  console.log('Connected to MySQL database');
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
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const isValidType = allowedTypes.test(file.mimetype);
    const isValidExt = allowedTypes.test(path.extname(file.originalname).toLowerCase());

    if (isValidType && isValidExt) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed'));
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

    // let positiveScore = Math.max(0, score);
    // let negativeScore = Math.abs(Math.min(0, score));
    // let neutralScore = 1 - positiveScore - negativeScore;
    

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

// API Endpoints

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
app.post('/api/entries', upload.single('entry_image'), (req, res) => {
  const { journal_id, entry_description, entry_datetime, entry_location, entry_location_name } = req.body;

  if (!journal_id || !entry_description || !entry_datetime) {
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(400).json({ message: 'Journal ID, description, and datetime are required' });
  }

  const { sentiment, positive_percentage, negative_percentage, neutral_percentage } = analyzeSentiment(entry_description);
  const entry_image = req.file ? `/uploads/${req.file.filename}` : null;

  const query = `INSERT INTO entries 
               (journal_id, entry_description, entry_datetime, sentiment, 
                entry_location, entry_location_name, entry_image, 
                positive_percentage, negative_percentage, neutral_percentage) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  db.query(query, [
    journal_id, entry_description, entry_datetime, sentiment, 
    entry_location, entry_location_name, entry_image, 
    positive_percentage, negative_percentage, neutral_percentage
  ], (err, result) => {
    if (err) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
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
      imageUrl: entry_image,
    });
  });
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
app.put('/api/entries/:entryId', upload.single('entry_image'), (req, res) => {
  const { entryId } = req.params;
  const { entry_description, entry_datetime, entry_location, entry_location_name, existing_image, clear_image } = req.body;

  const { sentiment, positive_percentage, negative_percentage, neutral_percentage } = analyzeSentiment(entry_description);

  let entry_image = existing_image;
  
  if (clear_image === 'true') {
    entry_image = null;
    
    if (existing_image) {
      const oldImagePath = path.join(__dirname, existing_image);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath); 
      }
    }
  }

  if (req.file) {
    entry_image = `/uploads/${req.file.filename}`;
    
    if (existing_image && existing_image !== entry_image) {
      const oldImagePath = path.join(__dirname, existing_image);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
    }
  }

  const query = `UPDATE entries 
                 SET entry_description = ?, entry_datetime = ?, sentiment = ?, 
                     positive_percentage = ?, negative_percentage = ?, neutral_percentage = ?, 
                     entry_location = ?, entry_location_name = ?, entry_image = ? 
                 WHERE entry_id = ?`;

  db.query(query, [
    entry_description, 
    entry_datetime, 
    sentiment, 
    positive_percentage, 
    negative_percentage, 
    neutral_percentage, 
    entry_location, 
    entry_location_name, 
    entry_image, 
    entryId
  ], (err, results) => {
    if (err) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
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
      imageUrl: entry_image
    });
  });
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