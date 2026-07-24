const puppeteer = require('puppeteer');
const fs = require('fs');

async function runScraper() {
    console.log("🚀 Starting TNREGINET Complete Scraper (Popup Close + guideLineSearchDiv)...");

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
        console.log("1️⃣ Opening Homepage...");
        await page.goto('https://tnreginet.gov.in/portal/?UserLocaleID=ta', { 
            waitUntil: 'domcontentloaded', 
            timeout: 120000 
        });

        await new Promise(r => setTimeout(r, 3000));

        // Close initial modal popup overlays if present
        console.log("❌ Closing initial announcement popup overlay if present...");
        await page.evaluate(() => {
            const closeBtns = Array.from(document.querySelectorAll('button, a, span, div, input, i'))
                .filter(el => {
                    const txt = (el.innerText || el.value || '').trim();
                    const cls = String(el.className || '');
                    return txt === '×' || txt === 'X' || txt.includes('மூடுக') || txt.includes('Close') || cls.includes('close') || cls.includes('modal');
                });
            closeBtns.forEach(b => { try { b.click(); } catch(e){} });
        });

        await new Promise(r => setTimeout(r, 2000));

        // 2. Select Zone (சேலம் / Salem)
        console.log("2️⃣ Selecting Zone: சேலம்...");
        const zoneVal = await page.evaluate(() => {
            const zEl = document.getElementById('districtList') || document.querySelectorAll('select')[0];
            const opt = Array.from(zEl.options).find(o => o.text.includes('சேலம்'));
            return opt ? opt.value : null;
        });

        if (zoneVal) {
            await page.select('#districtList', zoneVal);
        }
        await new Promise(r => setTimeout(r, 4000));

        // 3. Select SRO (பெத்தநாயக்கன்பாளையம்)
        console.log("3️⃣ Selecting SRO: பெத்தநாயக்கன்பாளையம்...");
        const sroVal = await page.evaluate(() => {
            const sEl = document.getElementById('SROList') || document.querySelectorAll('select')[1];
            const opt = Array.from(sEl.options).find(o => o.text.includes('பெத்தநாயக்கன்பாளையம்')) || 
                        Array.from(sEl.options).find(o => o.value !== '-1' && o.value !== '' && o.value !== '0');
            return opt ? opt.value : null;
        });

        if (sroVal) {
            await page.select('#SROList', sroVal);
        }
        await new Promise(r => setTimeout(r, 4000));

        // 4. Get Villages
        const villageOptions = await page.evaluate(() => {
            const vEl = document.getElementById('villageList') || document.querySelectorAll('select')[2];
            if (!vEl) return [];
            return Array.from(vEl.options)
                .filter(opt => opt.value && opt.value !== '-1' && opt.value !== '0' && opt.text.trim() !== 'தெரிவு செய்க')
                .map(opt => ({ text: opt.text.trim(), value: opt.value }));
        });

        console.log(`🤖 Loaded ${villageOptions.length} villages!`);

        if (villageOptions.length === 0) {
            console.log("⚠️ No villages found. Exiting.");
            await browser.close();
            return;
        }

        const testVillage = villageOptions[0];
        console.log(`⏳ Selecting village 1: ${testVillage.text} (ID: ${testVillage.value})...`);

        await page.select('#villageList', testVillage.value);
        await new Promise(r => setTimeout(r, 3000));

        // 5. Submit Form via guideLineSearchDiv() or "சமர்ப்பிக்க" button
        console.log("5️⃣ Triggering guideLineSearchDiv() / 'சமர்ப்பிக்க' button...");
        const searchTriggered = await page.evaluate(() => {
            if (typeof guideLineSearchDiv === 'function') {
                guideLineSearchDiv();
                return 'executed guideLineSearchDiv()';
            }
            const btn = Array.from(document.querySelectorAll('button, input, a'))
                .find(b => (b.innerText || b.value || '').trim() === 'சமர்ப்பிக்க');
            if (btn) {
                btn.click();
                return 'clicked சமர்ப்பிக்க button';
            }
            return false;
        });

        console.log(`Search status: ${searchTriggered}`);

        // Wait for AJAX table insertion into DOM
        console.log("⏳ Waiting for AJAX results table to render in DOM...");
        await page.waitForFunction(() => {
            return document.querySelectorAll('tr').length > 2 || document.body.innerText.includes('வரிசை');
        }, { timeout: 15000 }).catch(e => console.log("Timed out waiting for table rows."));

        await new Promise(r => setTimeout(r, 3000));

        // Extract records from table
        const records = await page.evaluate((vName) => {
            const allTrs = document.querySelectorAll('tr');
            const list = [];

            allTrs.forEach((row) => {
                const cols = row.querySelectorAll('td, th');
                if (cols.length >= 3) {
                    let col0 = cols[0]?.innerText.trim() || '';
                    let col1 = cols[1]?.innerText.trim().replace(/\r?\n|\r/g, ' ') || '';
                    let col2 = cols[2]?.innerText.trim() || '';
                    let col3 = cols[3]?.innerText.trim() || '';
                    let col4 = cols[4]?.innerText.trim().replace(/\r?\n|\r/g, ' ') || '';

                    if (col1 !== '' && !col1.includes('தேடல்') && !col1.includes('மண்டலம்')) {
                        list.push(`"${vName}","${col1}","${col4}","${col2}","${col3}"`);
                    }
                }
            });
            return list;
        }, testVillage.text);

        console.log(`\n🎉 Extracted ${records.length} records for ${testVillage.text}!`);
        if (records.length > 0) {
            console.log("Sample Extracted Data:");
            records.forEach(r => console.log(`  -> ${r}`));
        }

    } catch (err) {
        console.error("❌ Scraper error:", err);
    } finally {
        console.log("\nLeaving Chrome open for 15 seconds so you can watch Chrome on screen...");
        await new Promise(r => setTimeout(r, 15000));
        await browser.close();
    }
}

runScraper();
