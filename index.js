const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS - allow all origins for now
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

app.use(express.json());

// SellerCloud credentials (from environment variables for security)
const SELLERCLOUD = {
  baseUrl: 'https://blny.api.sellercloud.com/rest/api',
  username: process.env.SC_USERNAME || 'henry@goldlabelny.com',
  password: process.env.SC_PASSWORD || 'Corishabt1987!!'
};

let cachedToken = null;
let tokenExpiry = null;

// Generate/refresh SellerCloud token
async function getToken() {
  // Check if we have a valid cached token
  if (cachedToken && tokenExpiry) {
    const now = Date.now();
    const timeLeft = tokenExpiry - now;
    if (timeLeft > 5 * 60 * 1000) {
      console.log('Using cached token');
      return cachedToken;
    }
  }

  // Generate new token
  console.log('Generating new SellerCloud token...');
  try {
    const response = await fetch(`${SELLERCLOUD.baseUrl}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        Username: SELLERCLOUD.username,
        Password: SELLERCLOUD.password
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token request failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.access_token) {
      throw new Error('No access_token in response');
    }

    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (55 * 60 * 1000); // 55 minutes
    
    console.log('Token generated successfully');
    return cachedToken;

  } catch (error) {
    console.error('Token generation error:', error);
    throw error;
  }
}

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'SellerCloud Proxy is running',
    endpoints: {
      search: 'POST /api/search',
      test: 'GET /api/test'
    }
  });
});

// Test connection endpoint
app.get('/api/test', async (req, res) => {
  try {
    const token = await getToken();
    
    const response = await fetch(`${SELLERCLOUD.baseUrl}/Catalog?model.pageSize=1&model.pageNumber=1`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`SellerCloud API returned ${response.status}`);
    }

    const data = await response.json();
    
    res.json({
      success: true,
      totalProducts: data.TotalResults || 0,
      message: 'SellerCloud API connection successful'
    });

  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Search endpoint
app.post('/api/search', async (req, res) => {
  try {
    const { searchText } = req.body;
    
    if (!searchText) {
      return res.status(400).json({ error: 'searchText is required' });
    }

    const token = await getToken();
    
    console.log('Searching for:', searchText);

    // Try 3 variations like in the original code
    const searchVariations = [
      searchText,
      searchText.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      searchText.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1').replace(/S/g, '5').replace(/B/g, '8')
    ];

    let allItems = [];

    for (const variation of searchVariations) {
      const apiUrl = `${SELLERCLOUD.baseUrl}/Catalog?model.sKU=${encodeURIComponent(variation)}`;
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.Items && data.Items.length > 0) {
          allItems.push(...data.Items);
        }
      }
    }

    // Deduplicate by ID
    const uniqueItems = [];
    const seenIds = new Set();
    for (const item of allItems) {
      if (!seenIds.has(item.ID)) {
        seenIds.add(item.ID);
        uniqueItems.push(item);
      }
    }

    console.log(`Found ${uniqueItems.length} unique results`);

    res.json({
      success: true,
      items: uniqueItems,
      searchText: searchText
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`SellerCloud Proxy running on port ${PORT}`);
});
