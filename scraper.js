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
    console.log("🚀 Starting TNREGINET Targeted Scraper...");

    const browser = await puppeteer.launch({
        headless: false, // Visible Chrome window
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
        console.log("1️⃣ Navigating to TNREGINET Portal Homepage...");
        await page.goto('https://tnreginet.gov.in/portal/?UserLocaleID=ta', { 
            waitUntil: 'domcontentloaded', 
            timeout: 120000 
        });

        console.log("2️⃣ Navigating to Guideline Value Search...");
        await new Promise(r => setTimeout(r, 3000));

        await page.evaluate(() => {
            const allElements = Array.from(document.querySelectorAll('a, button, span, td, div'));
            const match = allElements.find(el => {
                const txt = (el.innerText || '').trim();
                return txt === 'வழிகாட்டி மதிப்பு' || txt.includes('வழிகாட்டி மதிப்பு விவரம்');
            });
            if (match) match.click();
        });

        await new Promise(r => setTimeout(r, 4000));
        await page.waitForSelector('#cmb_zone, select', { timeout: 30000 });

        // Ensure "Street" and "Village-wise" radio buttons are checked
        await page.evaluate(() => {
            const radios = document.querySelectorAll('input[type="radio"]');
            if (radios.length > 0) radios[0].click();
            const villageRadio = Array.from(radios).find(r => (r.nextSibling?.textContent || r.parentElement?.textContent || '').includes('கிராம'));
            if (villageRadio) villageRadio.click();
        });

        await new Promise(r => setTimeout(r, 2000));

        // 3. Select Zone (சேலம் / Salem) by ID #cmb_zone
        console.log("3️⃣ Selecting Zone (சேலம்)...");
        await page.evaluate(() => {
            const zEl = document.getElementById('cmb_zone') || document.querySelectorAll('select')[0];
            if (!zEl) return;
            const opt = Array.from(zEl.options).find(o => o.text.includes('சேலம்'));
            if (opt) {
                zEl.value = opt.value;
                zEl.dispatchEvent(new Event('change'));
            }
        });

        await new Promise(r => setTimeout(r, 5000));

        // 4. Select SRO by ID #cmb_sub_registrar_office
        console.log("4️⃣ Selecting Sub-Registrar Office (பெத்தநாயக்கன்பாளையம்)...");
        capturedXmls = []; // Clear XML buffer to capture village XML
        
        await page.evaluate(() => {
            const sEl = document.getElementById('cmb_sub_registrar_office') || document.querySelectorAll('select')[1];
            if (!sEl) return;
            const opt = Array.from(sEl.options).find(o => o.text.includes('பெத்தநாயக்கன்பாளையம்')) || 
                        Array.from(sEl.options).find(o => o.value !== '-1' && o.value !== '');
            if (opt) {
                sEl.value = opt.value;
                sEl.dispatchEvent(new Event('change'));
            }
        });

        await new Promise(r => setTimeout(r, 5000));

        // 5. Get Villages from DOM (#cmb_reg_village) OR from Intercepted XML
        let villageOptions = await page.evaluate(() => {
            const vEl = document.getElementById('cmb_reg_village') || document.querySelectorAll('select')[2];
            if (!vEl) return [];
            return Array.from(vEl.options)
                .filter(opt => opt.value !== '-1' && opt.value !== '')
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
            const vEl = document.getElementById('cmb_reg_village') || document.querySelectorAll('select')[2];
            if (!vEl) return;
            vEl.value = val;
            vEl.dispatchEvent(new Event('change'));
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
