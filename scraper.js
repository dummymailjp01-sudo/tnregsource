const puppeteer = require('puppeteer');
const fs = require('fs');

async function runScraper() {
    console.log("🚀 Starting TNREGINET Single-Village Test Scraper...");

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
        await page.waitForSelector('select', { timeout: 30000 });

        // Ensure radio buttons are selected
        await page.evaluate(() => {
            const radios = document.querySelectorAll('input[type="radio"]');
            if (radios.length > 0) radios[0].click();
            const villageRadio = Array.from(radios).find(r => (r.nextSibling?.textContent || r.parentElement?.textContent || '').includes('கிராம'));
            if (villageRadio) villageRadio.click();
        });

        await new Promise(r => setTimeout(r, 2000));

        // 1. Select Zone (சேலம் / Salem)
        console.log("Selecting Zone (சேலம்)...");
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

        // 2. Select SRO (Sub-Registrar Office)
        console.log("Selecting Sub-Registrar Office...");
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

        // 3. Extract Village Options
        const selects = await page.$$('select');
        const villageOptions = await page.evaluate(el => {
            return Array.from(el.options)
                .filter(opt => opt.value !== '-1' && opt.value !== '')
                .map(opt => ({ text: opt.text.trim(), value: opt.value }));
        }, selects[2]);

        console.log(`🤖 Found ${villageOptions.length} total villages. Testing ONLY the FIRST village...`);

        if (villageOptions.length === 0) {
            console.log("⚠️ No villages found. Exiting.");
            await browser.close();
            return;
        }

        // --- TEST ONLY THE FIRST VILLAGE ---
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

        // Wait 7 seconds for results to render
        await new Promise(r => setTimeout(r, 7000));

        // Print Diagnostic Page Content
        const pageAnalysis = await page.evaluate(() => {
            const trs = Array.from(document.querySelectorAll('tr')).map(tr => {
                return Array.from(tr.querySelectorAll('td, th')).map(cell => cell.innerText.trim()).join(' | ');
            }).filter(text => text.length > 0);

            return {
                url: window.location.href,
                totalTables: document.querySelectorAll('table').length,
                totalTrs: document.querySelectorAll('tr').length,
                trSnippets: trs.slice(0, 15) // First 15 rows
            };
        });

        console.log("\n📊 --- PAGE DIAGNOSTIC RESULTS ---");
        console.log(`URL: ${pageAnalysis.url}`);
        console.log(`Total Tables: ${pageAnalysis.totalTables} | Total Rows: ${pageAnalysis.totalTrs}`);
        console.log("Row Snippets Found on Screen:");
        pageAnalysis.trSnippets.forEach((snippet, idx) => console.log(`  Row ${idx + 1}: ${snippet}`));

        // Scrape table records
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

        console.log(`\n✅ Test Village Extraction Result: ${records.length} records extracted.`);
        if (records.length > 0) {
            console.log("Sample Record Data:");
            console.log(records[0]);
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
