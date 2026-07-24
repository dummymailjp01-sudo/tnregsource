const puppeteer = require('puppeteer');
const fs = require('fs');

async function runScraper() {
    console.log("🚀 Starting TNREGINET Frame-Aware Single-Village Test Scraper...");

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
        console.log("Navigating to portal...");
        await page.goto('https://tnreginet.gov.in/portal/?UserLocaleID=ta', { 
            waitUntil: 'domcontentloaded', 
            timeout: 120000 
        });

        console.log("Page loaded successfully.");
        await new Promise(r => setTimeout(r, 3000));

        // Helper function to find the active content frame (iFrame / Main Frame)
        async function getActiveFrame() {
            const frames = page.frames();
            for (const frame of frames) {
                const hasSelects = await frame.evaluate(() => document.querySelectorAll('select').length > 0).catch(() => false);
                if (hasSelects) return frame;
            }
            return page.mainFrame();
        }

        let frame = await getActiveFrame();
        console.log(`🎯 Active Content Frame URL: ${frame.url()}`);

        // Ensure radio buttons are selected
        await frame.evaluate(() => {
            const radios = document.querySelectorAll('input[type="radio"]');
            if (radios.length > 0) radios[0].click();
            const villageRadio = Array.from(radios).find(r => (r.nextSibling?.textContent || r.parentElement?.textContent || '').includes('கிராம'));
            if (villageRadio) villageRadio.click();
        });

        await new Promise(r => setTimeout(r, 2000));

        // 1. Select Zone (சேலம் / Salem)
        console.log("Selecting Zone (சேலம்)...");
        await frame.evaluate(() => {
            const selects = document.querySelectorAll('select');
            if (!selects[0]) return;
            const opt = Array.from(selects[0].options).find(o => o.text.includes('சேலம்'));
            if (opt) {
                selects[0].value = opt.value;
                selects[0].dispatchEvent(new Event('change'));
            }
        });

        await new Promise(r => setTimeout(r, 4000));

        // Refresh frame reference in case of frame navigation
        frame = await getActiveFrame();

        // 2. Select SRO (Sub-Registrar Office)
        console.log("Selecting Sub-Registrar Office...");
        await frame.evaluate(() => {
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
        frame = await getActiveFrame();

        // 3. Extract Village Options
        const villageOptions = await frame.evaluate(() => {
            const selects = document.querySelectorAll('select');
            if (!selects[2]) return [];
            return Array.from(selects[2].options)
                .filter(opt => opt.value !== '-1' && opt.value !== '')
                .map(opt => ({ text: opt.text.trim(), value: opt.value }));
        });

        console.log(`🤖 Found ${villageOptions.length} total villages. Testing ONLY Village 1...`);

        if (villageOptions.length === 0) {
            console.log("⚠️ No villages found in frame. Exiting.");
            await browser.close();
            return;
        }

        const testVillage = villageOptions[0];
        console.log(`⏳ Testing village 1: ${testVillage.text} (Value: ${testVillage.value})...`);

        // Select 1st village
        await frame.evaluate((val) => {
            const selects = document.querySelectorAll('select');
            if (!selects[2]) return;
            selects[2].value = val;
            selects[2].dispatchEvent(new Event('change'));
        }, testVillage.value);

        await new Promise(r => setTimeout(r, 2000));

        // Click Search
        const searchClicked = await frame.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('input[type="button"], input[type="submit"], button'))
                .find(b => (b.value || b.innerText || '').trim() === 'தேடுக');
            if (btn) {
                btn.click();
                return true;
            }
            return false;
        });

        console.log(`Search button clicked inside frame: ${searchClicked}`);

        // Wait 7 seconds for search results to render inside frame
        await new Promise(r => setTimeout(r, 7000));

        // Check all frames after search
        console.log("\n📊 --- SCANNING ALL FRAMES AFTER SEARCH ---");
        const allFrames = page.frames();
        console.log(`Total Frames Detected: ${allFrames.length}`);

        let resultsFrame = null;
        for (let idx = 0; idx < allFrames.length; idx++) {
            const f = allFrames[idx];
            const stats = await f.evaluate(() => {
                return {
                    url: window.location.href,
                    tableCount: document.querySelectorAll('table').length,
                    trCount: document.querySelectorAll('tr').length,
                    tdCount: document.querySelectorAll('td').length,
                    bodyText: document.body ? document.body.innerText.substring(0, 150).replace(/\n/g, ' ') : ''
                };
            }).catch(() => null);

            if (stats) {
                console.log(`  Frame [${idx}] URL: "${stats.url}" | Tables: ${stats.tableCount} | TRs: ${stats.trCount} | Snippet: "${stats.bodyText}"`);
                if (stats.trCount > 0 && (stats.bodyText.includes('வரிசை') || stats.bodyText.includes('தேடல்') || stats.trCount > 2)) {
                    resultsFrame = f;
                }
            }
        }

        if (!resultsFrame) resultsFrame = await getActiveFrame();

        // Extract records from the target frame
        const records = await resultsFrame.evaluate((vName) => {
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

        console.log(`\n✅ Test Village Extraction Result: ${records.length} records extracted.`);
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
