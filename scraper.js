const puppeteer = require('puppeteer');
const fs = require('fs');

async function runScraper() {
    console.log("🚀 Starting TNREGINET Visual Debug Scraper...");

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
        console.log("1️⃣ Navigating DIRECTLY to Guideline Value Search Page...");
        await page.goto('https://tnreginet.gov.in/portal/GuidelineValueSearch.do?UserLocaleID=ta', { 
            waitUntil: 'domcontentloaded', 
            timeout: 120000 
        }).catch(async () => {
            await page.goto('https://tnreginet.gov.in/portal/GuidelineValue.do?UserLocaleID=ta', { waitUntil: 'domcontentloaded' });
        });

        console.log("2️⃣ Waiting for Search Form...");
        await page.waitForSelector('select', { timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));

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
            const opt = Array.from(zEl.options).find(o => o.text.includes('சேலம்'));
            if (opt) {
                zEl.value = opt.value;
                zEl.dispatchEvent(new Event('change'));
            }
        });

        await new Promise(r => setTimeout(r, 5000));

        // 4. Select SRO (Sub-Registrar Office)
        console.log("4️⃣ Selecting Sub-Registrar Office (பெத்தநாயக்கன்பாளையம்)...");
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

        // 5. Get Villages safely from DOM
        let villageOptions = await page.evaluate(() => {
            const selects = document.querySelectorAll('select');
            const vEl = document.getElementById('cmb_reg_village') || selects[2] || selects[selects.length - 1];
            if (!vEl || !vEl.options) return [];

            return Array.from(vEl.options)
                .filter(opt => opt.value && opt.value !== '-1' && opt.value !== '')
                .map(opt => ({ text: opt.text.trim(), value: opt.value }));
        });

        console.log(`🤖 Found ${villageOptions.length} total villages. Testing ONLY Village 1...`);

        if (villageOptions.length === 0) {
            console.log("⚠️ No villages found in DOM. Exiting.");
            await browser.close();
            return;
        }

        const testVillage = villageOptions[0];
        console.log(`⏳ Testing village 1: ${testVillage.text} (Value: ${testVillage.value})...`);

        // Select 1st village
        await page.evaluate((val) => {
            const selects = document.querySelectorAll('select');
            const vEl = document.getElementById('cmb_reg_village') || selects[2] || selects[selects.length - 1];
            if (vEl && vEl.options) {
                vEl.value = val;
                vEl.dispatchEvent(new Event('change'));
            }
        }, testVillage.value);

        // Wait 3 seconds for village change AJAX to settle
        await new Promise(r => setTimeout(r, 3000));

        // Click Search
        console.log("5️⃣ Clicking Search button...");
        const searchClicked = await page.evaluate(() => {
            // Check for explicit search functions or buttons
            if (typeof fn_search === 'function') { fn_search(); return 'called fn_search()'; }
            if (typeof search === 'function') { search(); return 'called search()'; }

            const btn = Array.from(document.querySelectorAll('input, button, a'))
                .find(b => (b.value || b.innerText || '').trim() === 'தேடுக');
            if (btn) {
                btn.click();
                return 'clicked button element';
            }
            return false;
        });

        console.log(`Search action: ${searchClicked}`);
        await new Promise(r => setTimeout(r, 8000));

        // TAKE DEBUG SCREENSHOT AND RECORD TEXT
        console.log("📸 Saving debug screenshot (debug_page.png)...");
        await page.screenshot({ path: 'debug_page.png', fullPage: true });

        const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '');
        fs.writeFileSync('debug_page.txt', bodyText, 'utf8');
        console.log("📄 Saved page text to debug_page.txt");

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

    } catch (err) {
        console.error("❌ Scraper error:", err);
    } finally {
        console.log("\nLeaving Chrome open for 15 seconds so you can inspect the screen...");
        await new Promise(r => setTimeout(r, 15000));
        await browser.close();
    }
}

runScraper();
