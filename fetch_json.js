const axios = require('axios');
const fs = require('fs');

// TNREGINET Base Portal URL
const BASE_URL = 'https://tnreginet.gov.in/portal';

async function fetchJSONData() {
    console.log("📡 Fetching TNREGINET Data via direct HTTP JSON API...");

    try {
        // Create an Axios instance with realistic browser headers
        const client = axios.create({
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        // 1. Fetch initial Portal Session Cookie
        console.log("1️⃣ Initializing Session...");
        const sessionRes = await client.get(`${BASE_URL}/?UserLocaleID=ta`);
        const cookies = sessionRes.headers['set-cookie'];

        console.log("2️⃣ Requesting SRO & Village JSON structures...");

        // Example: Direct POST/GET query payload for Guideline Value backend
        // TNREGINET accepts form-urlencoded queries to fetch SROs and Villages
        const response = await client.post(`${BASE_URL}/GuidelineValueSearch.do`, 
            'searchType=villageWise&zoneCode=11&sroCode=218', 
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': cookies ? cookies.join('; ') : ''
                }
            }
        );

        console.log("3️⃣ Processing Server Response...");
        
        // Save the raw response structure to JSON
        const outputData = {
            timestamp: new Date().toISOString(),
            status: response.status,
            data: response.data
        };

        fs.writeFileSync('tnreginet_data.json', JSON.stringify(outputData, null, 2), 'utf8');
        console.log("🎉 Successfully saved raw data to tnreginet_data.json!");

    } catch (err) {
        console.error("❌ Error fetching JSON data:", err.message);
    }
}

fetchJSONData();
