const puppeteer = require('puppeteer');
const fs = require('fs');

async function runScraper() {
    console.log("🚀 Starting TNREGINET Scraper...");

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    try {
        console.log("Navigating to portal...");
        await page.goto('https://tnreginet.gov.in/portal/?UserLocaleID=ta', { 
            waitUntil: 'domcontentloaded', 
            timeout: 120000 
        });

        console.log("Page loaded successfully.");

        // Wait for select elements to be available
        await page.waitForSelector('select', { timeout: 30000 });

        const selects = await page.$$('select');
        if (selects.length < 3) {
            console.error("Could not find all required dropdowns.");
            await browser.close();
            return;
        }

        // Extract all village options from 3rd dropdown
        const villageOptions = await page.evaluate(el => {
            return Array.from(el.options)
                .filter(opt => opt.value !== '-1' && opt.value !== '')
                .map(opt => ({ text: opt.text.trim(), value: opt.value }));
        }, selects[2]);

        console.log(`🤖 Found ${villageOptions.length} villages to extract.`);

        let masterCsvData = "Village Name,Identifier,Classification,Guideline Value (British),Guideline Value (Metric)\n";
        let totalRecords = 0;

        for (let i = 0; i < villageOptions.length; i++) {
            const currentVillage = villageOptions[i];
            console.log(`⏳ [${i + 1}/${villageOptions.length}] Extracting: ${currentVillage.text}...`);

            // Select village and trigger change event
            await page.evaluate((val) => {
                const s = document.querySelectorAll('select')[2];
                s.value = val;
                s.dispatchEvent(new Event('change'));
            }, currentVillage.value);

            await new Promise(r => setTimeout(r, 1500));

            // Click Search button
            const clicked = await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('input[type="button"], input[type="submit"], button'))
                    .find(b => (b.value || b.innerText || '').trim() === 'தேடுக');
                if (btn) {
                    btn.click();
                    return true;
                }
                return false;
            });

            if (!clicked) {
                console.log(`⚠️ Search button not found for ${currentVillage.text}`);
                continue;
            }

            // Wait for response table
            await new Promise(r => setTimeout(r, 6000));

            // Scrape table rows
            const records = await page.evaluate((vName) => {
                const rows = document.querySelectorAll('table tr');
                if (rows.length <= 1) return [];

                const isStreet = (rows[0].innerText || "").includes("தெரு");
                const list = [];

                Array.from(rows).forEach((row, index) => {
                    if (index === 0) return;
                    const cols = row.querySelectorAll('td');
                    if (cols.length < 4) return;

                    let id = "", cls = "", valB = "", valM = "";
                    if (isStreet) {
                        id = cols[1]?.innerText.trim() || '';
                        cls = cols[2]?.innerText.trim() || '';
                        valB = cols[3]?.innerText.trim() || '';
                        valM = cols[4]?.innerText.trim() || '';
                    } else {
                        id = cols[1]?.innerText.trim() || '';
                        valB = cols[2]?.innerText.trim() || '';
                        valM = cols[3]?.innerText.trim() || '';
                        cls = cols[4]?.innerText.trim() || '';
                    }
                    list.push(`"${vName}","${id}","${cls}","${valB}","${valM}"`);
                });
                return list;
            }, currentVillage.text);

            if (records.length > 0) {
                masterCsvData += records.join('\n') + '\n';
                totalRecords += records.length;
                console.log(`✅ Extracted ${records.length} records.`);
            } else {
                console.log(`⚠️ No table records found for ${currentVillage.text}.`);
            }
        }

        // Write output to CSV file
        fs.writeFileSync('Salem_SRO_Bulk_Extract.csv', "\uFEFF" + masterCsvData, 'utf8');
        console.log(`🎉 Scraping complete! Saved ${totalRecords} total records to Salem_SRO_Bulk_Extract.csv`);

    } catch (err) {
        console.error("❌ Scraper error:", err);
    } finally {
        await browser.close();
    }
}

runScraper();
