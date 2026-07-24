const puppeteer = require('puppeteer');
const fs = require('fs');

async function runScraper() {
    console.log("🚀 Starting Complete TNREGINET Bulk Village Scraper...");

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
        // STEP 1: Open Homepage
        console.log("1️⃣ Opening Homepage...");
        await page.goto('https://tnreginet.gov.in/portal/?UserLocaleID=ta', { 
            waitUntil: 'domcontentloaded', 
            timeout: 120000 
        });

        await new Promise(r => setTimeout(r, 3000));

        // STEP 2: Close Initial Popup Overlay
        console.log("2️⃣ Closing initial popup overlay...");
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

        // STEP 3: Click "2002-லிருந்து வழிகாட்டி மதிப்புகளை பார்வையிட"
        console.log("3️⃣ Clicking '2002-லிருந்து வழிகாட்டி மதிப்புகளை பார்வையிட' link...");
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a, button, span, font'));
            const l2002 = links.find(l => (l.innerText || '').includes('2002'));
            if (l2002) l2002.click();
        });

        await new Promise(r => setTimeout(r, 4000));

        // STEP 4: Click "1-7-2024" Date Range Link
        console.log("4️⃣ Clicking '1-7-2024' date range link...");
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a, td, span, button'));
            const dLink = links.find(l => (l.innerText || '').includes('1-7-2024') || (l.innerText || '').includes('01/07/2024') || (l.innerText || '').includes('1/7/2024'));
            if (dLink) dLink.click();
        });

        await new Promise(r => setTimeout(r, 4000));

        // STEP 5: Select "கிராம வாரியாக" (Village-wise) Radio Button
        console.log("5️⃣ Selecting 'கிராம வாரியாக' radio button...");
        await page.evaluate(() => {
            const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
            const villageRadio = radios.find(r => {
                const parentText = r.parentElement ? r.parentElement.innerText : '';
                const nextText = r.nextSibling ? r.nextSibling.textContent : '';
                return parentText.includes('கிராம') || nextText.includes('கிராம');
            }) || radios[1] || radios[0];

            if (villageRadio) {
                villageRadio.click();
                villageRadio.dispatchEvent(new Event('change'));
            }
        });

        await new Promise(r => setTimeout(r, 3000));

        // STEP 6: Select Zone (சேலம்)
        console.log("6️⃣ Selecting Zone: சேலம்...");
        await page.evaluate(() => {
            const selects = document.querySelectorAll('select');
            const zEl = document.getElementById('districtList') || document.getElementById('cmb_zone') || selects[0];
            if (!zEl) return;
            const opt = Array.from(zEl.options).find(o => o.text.includes('சேலம்'));
            if (opt) {
                zEl.value = opt.value;
                zEl.dispatchEvent(new Event('change'));
            }
        });

        await new Promise(r => setTimeout(r, 4000));

        // STEP 7: Select SRO (பெத்தநாயக்கன்பாளையம்)
        console.log("7️⃣ Selecting SRO: பெத்தநாயக்கன்பாளையம்...");
        await page.evaluate(() => {
            const selects = document.querySelectorAll('select');
            const sEl = document.getElementById('SROList') || document.getElementById('cmb_sub_registrar_office') || selects[1];
            if (!sEl) return;
            const opt = Array.from(sEl.options).find(o => o.text.includes('பெத்தநாயக்கன்பாளையம்')) || 
                        Array.from(sEl.options).find(o => o.value !== '-1' && o.value !== '' && o.value !== '0');
            if (opt) {
                sEl.value = opt.value;
                sEl.dispatchEvent(new Event('change'));
            }
        });

        await new Promise(r => setTimeout(r, 4000));

        // STEP 8: Get Villages List
        const villageOptions = await page.evaluate(() => {
            const selects = document.querySelectorAll('select');
            const vEl = document.getElementById('villageList') || document.getElementById('cmb_reg_village') || selects[2];
            if (!vEl) return [];
            return Array.from(vEl.options)
                .filter(opt => opt.value && opt.value !== '-1' && opt.value !== '0' && opt.text.trim() !== 'தெரிவு செய்க')
                .map(opt => ({ text: opt.text.trim(), value: opt.value }));
        });

        console.log(`🤖 Successfully loaded ${villageOptions.length} total villages for extraction!`);

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

            // If we are coming back from a previous search result, click "Go Back to Main List" button
            const backBtnClicked = await page.evaluate(() => {
                const backBtn = Array.from(document.querySelectorAll('input, button, a'))
                    .find(b => (b.value || b.innerText || '').includes('முதன்மை பட்டியலுக்கு'));
                if (backBtn) {
                    backBtn.click();
                    return true;
                }
                return false;
            });

            if (backBtnClicked) {
                await new Promise(r => setTimeout(r, 3000));

                // Re-select Zone & SRO if reset
                await page.evaluate(() => {
                    const selects = document.querySelectorAll('select');
                    const zEl = document.getElementById('districtList') || document.getElementById('cmb_zone') || selects[0];
                    if (zEl && zEl.selectedIndex <= 0) {
                        const opt = Array.from(zEl.options).find(o => o.text.includes('சேலம்'));
                        if (opt) { zEl.value = opt.value; zEl.dispatchEvent(new Event('change')); }
                    }
                });
                await new Promise(r => setTimeout(r, 2500));

                await page.evaluate(() => {
                    const selects = document.querySelectorAll('select');
                    const sEl = document.getElementById('SROList') || document.getElementById('cmb_sub_registrar_office') || selects[1];
                    if (sEl && sEl.selectedIndex <= 0) {
                        const opt = Array.from(sEl.options).find(o => o.text.includes('பெத்தநாயக்கன்பாளையம்')) || sEl.options[1];
                        if (opt) { sEl.value = opt.value; sEl.dispatchEvent(new Event('change')); }
                    }
                });
                await new Promise(r => setTimeout(r, 2500));
            }

            // Select Current Village
            await page.evaluate((val) => {
                const selects = document.querySelectorAll('select');
                const vEl = document.getElementById('villageList') || document.getElementById('cmb_reg_village') || selects[2];
                if (vEl) {
                    vEl.value = val;
                    vEl.dispatchEvent(new Event('change'));
                }
            }, currentVillage.value);

            await new Promise(r => setTimeout(r, 2000));

            // Click Search Button
            await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('input, button, a'));
                const visibleBtn = btns.find(b => {
                    const txt = (b.value || b.innerText || '').trim();
                    const isVisible = b.offsetWidth > 0 && b.offsetHeight > 0 && window.getComputedStyle(b).display !== 'none';
                    return txt === 'தேடுக' && isVisible;
                });
                if (visibleBtn) visibleBtn.click();
            });

            await new Promise(r => setTimeout(r, 5000));

            // Extract Records
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

                        if (col1.length > 0 && !col1.includes('தேடல்') && !col1.includes('மண்டலம்')) {
                            list.push(`"${vName}","${col1}","${col4}","${col2}","${col3}"`);
                        }
                    }
                });
                return list;
            }, currentVillage.text);

            if (records.length > 0) {
                masterCsvData += records.join('\n') + '\n';
                totalRecords += records.length;
                console.log(`✅ [${i + 1}/${villageOptions.length}] ${currentVillage.text}: Extracted ${records.length} records.`);
            } else {
                console.log(`⚠️ [${i + 1}/${villageOptions.length}] ${currentVillage.text}: No records found.`);
            }
        }

        // Save CSV output with UTF-8 BOM so Excel opens Tamil text properly
        fs.writeFileSync('Salem_SRO_Bulk_Extract.csv', "\uFEFF" + masterCsvData, 'utf8');
        console.log(`\n🎉 Scraping complete! Saved ${totalRecords} total records to Salem_SRO_Bulk_Extract.csv`);

    } catch (err) {
        console.error("❌ Scraper error:", err);
    } finally {
        await browser.close();
    }
}

runScraper();
