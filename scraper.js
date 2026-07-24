const puppeteer = require('puppeteer');
const fs = require('fs');

async function runScraper() {
    console.log("🚀 Starting TNREGINET Guideline Value Scraper...");

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

    try {
        console.log("1️⃣ Navigating to TNREGINET Portal Homepage...");
        await page.goto('https://tnreginet.gov.in/portal/?UserLocaleID=ta', { 
            waitUntil: 'domcontentloaded', 
            timeout: 120000 
        });

        console.log("2️⃣ Clicking 'வழிகாட்டி மதிப்பு' (Guideline Value) in the menu...");
        await new Promise(r => setTimeout(r, 3000));

        // Click the Guideline Value menu item on the homepage
        const clickedMenu = await page.evaluate(() => {
            const allElements = Array.from(document.querySelectorAll('a, button, span, td, div'));
            const match = allElements.find(el => {
                const txt = (el.innerText || '').trim();
                return txt === 'வழிகாட்டி மதிப்பு' || txt.includes('வழிகாட்டி மதிப்பு விவரம்');
            });
            if (match) {
                match.click();
                return match.innerText.trim();
            }
            return false;
        });

        console.log(`Menu clicked status: ${clickedMenu}`);
        await new Promise(r => setTimeout(r, 5000));

        // Ensure we are on the search form with dropdowns
        await page.waitForSelector('select', { timeout: 30000 });
        console.log("✅ Successfully landed on Guideline Value Search Form!");

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
            const selects = document.querySelectorAll('select');
            if (!selects[0]) return;
            const opt = Array.from(selects[0].options).find(o => o.text.includes('சேலம்'));
            if (opt) {
                selects[0].value = opt.value;
                selects[0].dispatchEvent(new Event('change'));
            }
        });

        await new Promise(r => setTimeout(r, 4000));

        // 4. Select SRO (Sub-Registrar Office)
        console.log("4️⃣ Selecting Sub-Registrar Office...");
        await page.evaluate(() => {
            const selects = document.querySelectorAll('select');
            if (!selects[1]) return;
            const opt = Array.from(selects[1].options).find(o => o.text.includes('பெத்தநாயக்கன்பாளையம்')) || 
                        Array.from(selects[1].options).find(o => o.value !== '-1' && o.value !== '');
            if (opt) {
                selects[1].value = opt.value;
                selects[1].dispatchEvent(new Event('change'));
            }
        });

        await new Promise(r => setTimeout(r, 4000));

        // 5. Extract Village Options
        const selects = await page.$$('select');
        const villageOptions = await page.evaluate(el => {
            return Array.from(el.options)
                .filter(opt => opt.value !== '-1' && opt.value !== '')
                .map(opt => ({ text: opt.text.trim(), value: opt.value }));
        }, selects[2]);

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
            if (!selects[2]) return;
            selects[2].value = val;
            selects[2].dispatchEvent(new Event('change'));
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

                    if (col0 !== 'வரிசை எண்' && col1 !== '') {
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
