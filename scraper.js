const puppeteer = require('puppeteer');
const fs = require('fs');

async function runScraper() {
    console.log("🚀 Starting TNREGINET Scraper...");

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

        console.log(`🤖 Found ${villageOptions.length} villages to extract.`);

        if (villageOptions.length === 0) {
            console.log("⚠️ No villages found. Exiting.");
            await browser.close();
            return;
        }

        let masterCsvData = "Village Name,Street / Survey Name,Classification,Guideline Value (British),Guideline Value (Metric)\n";
        let totalRecords = 0;

        for (let i = 0; i < villageOptions.length; i++) {
            const currentVillage = villageOptions[i];
            console.log(`⏳ [${i + 1}/${villageOptions.length}] Extracting: ${currentVillage.text}...`);

            // Step A: Go back to search form if on Results Page
            await page.evaluate(() => {
                const backBtn = Array.from(document.querySelectorAll('input, button, a'))
                    .find(b => (b.value || b.innerText || '').includes('முதன்மை பட்டியலுக்கு'));
                if (backBtn) backBtn.click();
            });
            await new Promise(r => setTimeout(r, 3000));

            // Ensure Zone & SRO selections are preserved
            await page.evaluate(() => {
                const selects = document.querySelectorAll('select');
                if (selects[0] && selects[0].selectedIndex <= 0) {
                    const zOpt = Array.from(selects[0].options).find(o => o.text.includes('சேலம்'));
                    if (zOpt) { selects[0].value = zOpt.value; selects[0].dispatchEvent(new Event('change')); }
                }
            });
            await new Promise(r => setTimeout(r, 2000));

            await page.evaluate(() => {
                const selects = document.querySelectorAll('select');
                if (selects[1] && selects[1].selectedIndex <= 0) {
                    const sOpt = Array.from(selects[1].options).find(o => o.text.includes('பெத்தநாயக்கன்பாளையம்')) || selects[1].options[1];
                    if (sOpt) { selects[1].value = sOpt.value; selects[1].dispatchEvent(new Event('change')); }
                }
            });
            await new Promise(r => setTimeout(r, 2000));

            // Select current village
            const selected = await page.evaluate((val) => {
                const selects = document.querySelectorAll('select');
                if (!selects[2]) return false;
                selects[2].value = val;
                selects[2].dispatchEvent(new Event('change'));
                return true;
            }, currentVillage.value);

            if (!selected) {
                console.log(`⚠️ Village dropdown missing for ${currentVillage.text}`);
                continue;
            }

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

            if (!searchClicked) {
                console.log(`⚠️ Could not click Search button for ${currentVillage.text}`);
                continue;
            }

            // Wait 6 seconds for table data to render completely
            await new Promise(r => setTimeout(r, 6000));

            // Extract records from any table row containing data cells
            const records = await page.evaluate((vName) => {
                const allTrs = document.querySelectorAll('tr');
                const list = [];

                allTrs.forEach((row) => {
                    const cols = row.querySelectorAll('td');
                    // Data rows have at least 4 columns
                    if (cols.length >= 4) {
                        let col0 = cols[0]?.innerText.trim() || '';
                        let col1 = cols[1]?.innerText.trim().replace(/\r?\n|\r/g, ' ') || '';
                        let col2 = cols[2]?.innerText.trim() || '';
                        let col3 = cols[3]?.innerText.trim() || '';
                        let col4 = cols[4]?.innerText.trim().replace(/\r?\n|\r/g, ' ') || '';

                        // Filter out headers or empty rows
                        if (col0 !== 'வரிசை எண்' && col1 !== '' && !col1.includes('தேடல்')) {
                            list.push(`"${vName}","${col1}","${col4}","${col2}","${col3}"`);
                        }
                    }
                });
                return list;
            }, currentVillage.text);

            if (records.length > 0) {
                masterCsvData += records.join('\n') + '\n';
                totalRecords += records.length;
                console.log(`✅ ${currentVillage.text}: Extracted ${records.length} records.`);
            } else {
                console.log(`⚠️ ${currentVillage.text}: No records found.`);
            }
        }

        fs.writeFileSync('Salem_SRO_Bulk_Extract.csv', "\uFEFF" + masterCsvData, 'utf8');
        console.log(`🎉 Scraping complete! Saved ${totalRecords} total records to Salem_SRO_Bulk_Extract.csv`);

    } catch (err) {
        console.error("❌ Scraper error:", err);
    } finally {
        await browser.close();
    }
}

runScraper();
