const puppeteer = require('puppeteer');
const fs = require('fs');

function parseOptionsFromXML(xmlString) {
    const regex = /<option value=['"]([^'"]+)['"]>([^<]+)<\/option>/g;
    const options = [];
    let match;
    while ((match = regex.exec(xmlString)) !== null) {
        if (match[1] !== '-1' && match[1] !== '') {
            options.push({ value: match[1], text: match[2].trim() });
        }
    }
    return options;
}

async function runScraper() {
    console.log("🚀 Starting TNREGINET Direct-URL Scraper...");

    const browser = await puppeteer.launch({
        headless: false, // Visible Chrome browser window
        defaultViewport: null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--start-maximized'
        ]
    });

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    let capturedXmls = [];

    // Intercept webHP XML responses
    page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('webHP') || url.includes('GuidelineValue')) {
            try {
                const text = await response.text();
                if (text && text.includes('<option')) {
                    capturedXmls.push(text);
                }
            } catch (e) {}
        }
    });

    try {
        // Direct URL to Guideline Value Search Page (Bypasses homepage completely!)
        console.log("1️⃣ Navigating DIRECTLY to Guideline Value Search Page...");
        await page.goto('https://tnreginet.gov.in/portal/GuidelineValueSearch.do?UserLocaleID=ta', { 
            waitUntil: 'domcontentloaded', 
            timeout: 120000 
        }).catch(async () => {
            // Fallback URL if Search.do redirects
            await page.goto('https://tnreginet.gov.in/portal/GuidelineValue.do?UserLocaleID=ta', { waitUntil: 'domcontentloaded' });
        });

        console.log("2️⃣ Waiting for Search Form Dropdowns...");
        await page.waitForSelector('select', { timeout: 30000 });
        console.log("✅ Successfully landed DIRECTLY on Guideline Value Search Form!");

        // Ensure "Street" and "Village-wise" radio buttons are checked
        await page.evaluate(() => {
            const radios = document.querySelectorAll('input[type="radio"]');
            if (radios.length > 0) radios[0].click();
            const villageRadio = Array.from(radios).find(r => (r.nextSibling?.textContent || r.parentElement?.textContent || '').includes('கிராம'));
            if (villageRadio) villageRadio.click();
        });

        await new Promise(r => setTimeout(r, 2000));

        // 3. Select Zone (சேலம் / Salem)
        console.log("3️⃣ Selecting Zone (சேலம்)...");
        await page.evaluate(() => {
            const zEl = document.getElementById('cmb_zone') || document.querySelectorAll('select')[0];
            if (!zEl) return;
            const opts = zEl.tagName?.toLowerCase() === 'select' ? zEl.options : zEl.querySelectorAll('option');
            const opt = Array.from(opts || []).find(o => o.text.includes('சேலம்'));
            if (opt && zEl.tagName?.toLowerCase() === 'select') {
                zEl.value = opt.value;
                zEl.dispatchEvent(new Event('change'));
            }
        });

        await new Promise(r => setTimeout(r, 5000));

        // 4. Select SRO (Sub-Registrar Office)
        console.log("4️⃣ Selecting Sub-Registrar Office (பெத்தநாயக்கன்பாளையம்)...");
        capturedXmls = []; // Clear XML buffer to capture village XML
        
        await page.evaluate(() => {
            const sEl = document.getElementById('cmb_sub_registrar_office') || document.querySelectorAll('select')[1];
            if (!sEl) return;
            const opts = sEl.tagName?.toLowerCase() === 'select' ? sEl.options : sEl.querySelectorAll('option');
            const opt = Array.from(opts || []).find(o => o.text.includes('பெத்தநாயக்கன்பாளையம்')) || 
                        Array.from(opts || []).find(o => o.value !== '-1' && o.value !== '');
            if (opt && sEl.tagName?.toLowerCase() === 'select') {
                sEl.value = opt.value;
                sEl.dispatchEvent(new Event('change'));
            }
        });

        await new Promise(r => setTimeout(r, 5000));

        // 5. Get Villages safely from DOM OR from Intercepted XML
        let villageOptions = await page.evaluate(() => {
            const selects = document.querySelectorAll('select');
            const vEl = document.getElementById('cmb_reg_village') || selects[2] || selects[selects.length - 1];
            if (!vEl) return [];

            const opts = vEl.tagName?.toLowerCase() === 'select' ? vEl.options : vEl.querySelectorAll('option');
            if (!opts) return [];

            return Array.from(opts)
                .filter(opt => opt.value && opt.value !== '-1' && opt.value !== '')
                .map(opt => ({ text: opt.text.trim(), value: opt.value }));
        });

        // Fallback: Parse XML if DOM is not updated
        if (villageOptions.length === 0 && capturedXmls.length > 0) {
            console.log("📡 Extracting villages directly from intercepted XML response...");
            for (let xml of capturedXmls) {
                const parsed = parseOptionsFromXML(xml);
                if (parsed.length > villageOptions.length) {
                    villageOptions = parsed;
                }
            }
        }

        console.log(`🤖 Found ${villageOptions.length} total villages. Testing ONLY Village 1...`);

        if (villageOptions.length === 0) {
            console.log("⚠️ No villages found. Exiting.");
            await browser.close();
            return;
        }

        const testVillage = villageOptions[0];
        console.log(`⏳ Testing village 1: ${testVillage.text} (Value: ${testVillage.value})...`);

        // Select 1st village
        await page.evaluate((val) => {
            const selects = document.querySelectorAll('select');
            const vEl = document.getElementById('cmb_reg_village') || selects[2] || selects[selects.length - 1];
            if (vEl && vEl.tagName?.toLowerCase() === 'select') {
                vEl.value = val;
                vEl.dispatchEvent(new Event('change'));
            }
        }, testVillage.value);

        await new Promise(r => setTimeout(r, 2000));

        // Click Search
        const searchClicked = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('input[type="button"], input[type="submit"], button'))
                .find(b => (b.value || b.innerText || '').trim() === 'தேடுக');
            if (btn) {
                btn.click();
                return true;
            }
            return false;
        });

        console.log(`Search button clicked: ${searchClicked}`);
        await new Promise(r => setTimeout(r, 7000));

        // Extract records from table
        const records = await page.evaluate((vName) => {
            const allTrs = document.querySelectorAll('tr');
            const list = [];

            allTrs.forEach((row) => {
                const cols = row.querySelectorAll('td');
                if (cols.length >= 4) {
                    let col0 = cols[0]?.innerText.trim() || '';
                    let col1 = cols[1]?.innerText.trim().replace(/\r?\n|\r/g, ' ') || '';
                    let col2 = cols[2]?.innerText.trim() || '';
                    let col3 = cols[3]?.innerText.trim() || '';
                    let col4 = cols[4]?.innerText.trim().replace(/\r?\n|\r/g, ' ') || '';

                    if (col0 !== 'வரிசை எண்' && col1 !== '' && !col1.includes('தேடல்')) {
                        list.push(`"${vName}","${col1}","${col4}","${col2}","${col3}"`);
                    }
                }
            });
            return list;
        }, testVillage.text);

        console.log(`\n✅ Test Village Extraction Result: ${records.length} records extracted!`);
        if (records.length > 0) {
            console.log("Sample Extracted Data:");
            records.forEach(r => console.log(`  -> ${r}`));
        }

    } catch (err) {
        console.error("❌ Scraper error:", err);
    } finally {
        console.log("\nLeaving Chrome open for 15 seconds so you can inspect the screen...");
        await new Promise(r => setTimeout(r, 15000));
        await browser.close();
    }
}

runScraper();
