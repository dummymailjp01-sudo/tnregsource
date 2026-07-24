const axios = require('axios');
const fs = require('fs');

const BASE_URL = 'https://tnreginet.gov.in/portal';

async function fetchJSONData() {
    console.log("📡 Fetching TNREGINET Data via direct HTTP JSON API...");

    try {
        // 1. Initialize HTTP Client with strict browser headers (Bypasses 403 WAF block)
        const client = axios.create({
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,ta;q=0.8',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });

        console.log("1️⃣ Initializing Session and Cookie Jar...");
        const sessionRes = await client.get(`${BASE_URL}/?UserLocaleID=ta`);
        
        // Extract session cookies (JSESSIONID)
        const setCookies = sessionRes.headers['set-cookie'];
        const cookieHeader = setCookies ? setCookies.map(c => c.split(';')[0]).join('; ') : '';

        console.log("2️⃣ Sending Form Request with Referer/Origin headers...");

        // Query backend endpoint with full origin/referer context
        const response = await client.post(
            `${BASE_URL}/?UserLocaleID=ta`, 
            'searchType=villageWise&zoneCode=11&sroCode=218', 
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Origin': 'https://tnreginet.gov.in',
                    'Referer': 'https://tnreginet.gov.in/portal/?UserLocaleID=ta',
                    'Cookie': cookieHeader,
                    'X-Requested-With': 'XMLHttpRequest'
                }
            }
        );

        console.log(`3️⃣ Server Response Status: ${response.status}`);
        
        const outputData = {
            timestamp: new Date().toISOString(),
            status: response.status,
            data: response.data
        };

        fs.writeFileSync('tnreginet_data.json', JSON.stringify(outputData, null, 2), 'utf8');
        console.log("🎉 Successfully saved response to tnreginet_data.json!");

    } catch (err) {
        if (err.response) {
            console.error(`❌ HTTP Error ${err.response.status}: Server rejected request.`);
        } else {
            console.error("❌ Error fetching JSON data:", err.message);
        }
    }
}

fetchJSONData();
