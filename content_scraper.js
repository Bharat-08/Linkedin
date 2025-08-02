console.log("✅ Content script loaded...");

// Helper Functions
function waitForElement(selector, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const el = document.querySelector(selector);
        if (el) { return resolve(el); }
        const observer = new MutationObserver(() => {
            const found = document.querySelector(selector);
            if (found) { observer.disconnect(); resolve(found); }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timeout waiting for element: ${selector}`));
        }, timeout);
    });
}
async function scrollToBottom(delay = 300) {
    return new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 300;
        const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= scrollHeight) { clearInterval(timer); resolve(); }
        }, delay);
    });
}
async function clickAllExpandButtons(section) {
    if (!section) return;
    for (const btn of section.querySelectorAll('button.inline-show-more-text__button[aria-expanded="false"], button[aria-label*="See more"]')) {
        if (btn && btn.offsetParent !== null && !btn.disabled) {
            btn.click();
            await new Promise(res => setTimeout(res, 400));
        }
    }
}
async function exhaustInfiniteScroll(section) {
    if (!section) return;
    let lastHeight = -1;
    while (true) {
        let loadBtn = section.querySelector('.scaffold-finite-scroll__load-button');
        if (loadBtn && loadBtn.offsetParent !== null && !loadBtn.disabled) {
            loadBtn.scrollIntoView({ behavior: "smooth", block: "center" });
            loadBtn.click();
            await new Promise(res => setTimeout(res, 900));
            continue;
        }
        let curHeight = section.scrollHeight;
        if (curHeight === lastHeight) break;
        lastHeight = curHeight;
        await new Promise(res => setTimeout(res, 600));
    }
}
function parseExperienceItem(item, candidateName) {
    const lines = item.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !/comments|reposts/i.test(l) && l !== candidateName);
    if (lines.length === 0) return null;
    const obj = {};
    lines.forEach((line, idx) => {
        if (idx === 0) obj["Position"] = line;
        else if (idx === 1) obj["Company"] = line;
        else if (/present|[0-9]{4}/i.test(line) && !obj["Duration"]) obj["Duration"] = line;
        else if (/remote|india|area|on-site/i.test(line.toLowerCase()) && !obj["Location"]) obj["Location"] = line;
        else if (!obj["Description"]) obj["Description"] = line;
        else obj[`Extra_${idx}`] = line;
    });
    return obj;
}
function parseEducationItem(item) {
    const lines = item.innerText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    const obj = {};
    lines.forEach((line, idx) => {
        if (idx === 0) obj["School"] = line;
        else if (/bachelor|master|degree|diploma|cbse|jee/i.test(line.toLowerCase()) && !obj["Degree"]) obj["Degree"] = line;
        else if (/[0-9]{4}/.test(line) && !obj["Dates"]) obj["Dates"] = line;
        else if (/grade|gpa|cgpa|score/i.test(line.toLowerCase()) && !obj["Grades"]) obj["Grades"] = line;
        else if (!obj["Description"]) obj["Description"] = line;
        else obj[`Extra_${idx}`] = line;
    });
    return obj;
}

// Scrapers for Details Pages
async function scrapeExperienceDetailsPage() {
    console.log(`🏃‍♂️ Running on the Experience Details Page...`);
    const sectionToSearch = document.body;
    await clickAllExpandButtons(sectionToSearch);
    await scrollToBottom();
    const items = Array.from(document.querySelectorAll('li.pvs-list__paged-list-item'));
    const parsedData = items.map(item => parseExperienceItem(item, null)).filter(Boolean);
    console.log(`✅ Scraped ${parsedData.length} items from experience details page.`);
    chrome.runtime.sendMessage({
        type: "SCRAPED_DETAILS_PAGE",
        payload: { section: "experience", data: parsedData }
    });
}
async function scrapeEducationDetailsPage() {
    console.log(`🏃‍♂️ Running on the Education Details Page...`);
    const sectionToSearch = document.body;
    await clickAllExpandButtons(sectionToSearch);
    await scrollToBottom();
    const items = Array.from(document.querySelectorAll('li.pvs-list__paged-list-item'));
    const parsedData = items.map(item => parseEducationItem(item)).filter(Boolean);
    console.log(`✅ Scraped ${parsedData.length} items from education details page.`);
    chrome.runtime.sendMessage({
        type: "SCRAPED_DETAILS_PAGE",
        payload: { section: "education", data: parsedData }
    });
}

// Final, robust skills scraper
async function scrapeSkillsSection() {
    console.log("🏃‍♂️ Scraping all skill details...");
    const skillsData = [];

    try {
        const skillsAnchor = await waitForElement('#skills', 7000);
        const section = skillsAnchor.closest('section');
        if (!section) return skillsData;

        const skillItems = section.querySelectorAll(':scope > div > ul > li[class*="artdeco-list__item"]');

        for (const item of skillItems) {
            const skillNameEl = item.querySelector('a[data-field="skill_card_skill_topic"] span[aria-hidden="true"]');
            if (!skillNameEl) continue;

            const skillObject = {
                skillName: skillNameEl.textContent.trim(),
                details: []
            };

            const subItems = item.querySelectorAll('div.pvs-entity__sub-components li');
            for (const subItem of subItems) {
                const textEl = subItem.querySelector('span[aria-hidden="true"]');
                if (!textEl) continue;
                const detail = {
                    text: textEl.textContent.trim(),
                    type: 'unknown',
                    imageUrl: subItem.querySelector('img')?.src || null,
                    link: subItem.querySelector('a')?.href || null
                };
                const text = detail.text.toLowerCase();
                if (text.includes('endorse')) {
                    detail.type = text.includes('endorsements') ? 'endorsement_count' : 'endorsement_summary';
                } else if (detail.imageUrl) {
                    detail.type = 'related_credential';
                }
                if(detail.text) {
                    skillObject.details.push(detail);
                }
            }
            skillsData.push(skillObject);
        }

    } catch (error) {
        console.warn("Could not find or scrape the skills section:", error.message);
    }

    console.log(`✅ Scraped details for ${skillsData.length} skills.`);
    return skillsData;
}


async function scrapeRemainingSections() {
    console.log("🏃‍♂️ Scraping remaining sections (Experience & Skills)...");
    let experience = [];
    let skills = [];

    try {
        const expAnchor = await waitForElement('#experience', 7000);
        const expSection = expAnchor.closest('section');
        if (expSection) {
            console.log("...found experience section on main page, scraping it now.");
            await clickAllExpandButtons(expSection);
            await exhaustInfiniteScroll(expSection);
            const expItems = expSection.querySelectorAll('li.pvs-list__paged-list-item, li.artdeco-list__item');
            const candidateName = document.querySelector('h1')?.innerText.trim() || null;
            experience = Array.from(expItems).map(item => parseExperienceItem(item, candidateName)).filter(Boolean);
        }
    } catch (error) {
        console.warn("Could not find Experience section during final scrape:", error.message);
    }
    
    skills = await scrapeSkillsSection();

    return { experience, skills };
}

async function planAndScrapeProfile() {
    console.log("🧐 Planning and scraping initial profile data...");
    const candidateData = {
        candidate_name: null, current_title: null, current_company: null,
        linkedin_url: window.location.href, location_compatibility: null,
        candidate_description: '', education: [], experience: [],
        skills: [], about: null, source: 'LinkedIn Extension'
    };
    
    try { await waitForElement('h1'); await scrollToBottom(); } catch (e) { console.warn("⏳ Page load timeout:", e); }

    candidateData.candidate_name = document.querySelector('h1')?.innerText.trim() || null;
    candidateData.current_title = document.querySelector('.text-body-medium.break-words')?.innerText.trim() || null;
    candidateData.location_compatibility = document.querySelector('span.text-body-small.inline.t-black--light.break-words')?.innerText.trim() || null;
    const aboutAnchor = document.querySelector('#about');
    if (aboutAnchor) {
        const aboutSection = aboutAnchor.closest('section');
        if (aboutSection) candidateData.about = aboutSection.querySelector('.display-flex.ph5.pv3 span.visually-hidden')?.innerText.trim() || null;
    }

    const taskQueue = [];
    const eduSection = document.querySelector('#education')?.closest('section');
    if (eduSection) {
        const showAllEduURL = eduSection.querySelector('a[href*="/details/education"]')?.href;
        if (showAllEduURL) taskQueue.push(showAllEduURL);
    }
    const expSection = document.querySelector('#experience')?.closest('section');
    if (expSection) {
        const showAllExpURL = expSection.querySelector('a[href*="/details/experience"]')?.href;
        if (showAllExpURL) taskQueue.push(showAllExpURL);
    }
    
    if (taskQueue.length > 0) {
        console.log("📋 Plan created. Handing off to background script. Tasks:", taskQueue);
        chrome.runtime.sendMessage({
            type: "SETUP_SCRAPING_PLAN",
            payload: { mainProfileData: candidateData, taskQueue: taskQueue }
        });
    } else {
        console.log("📋 No detail pages found. Scraping everything from main profile now.");
        if (eduSection) {
            await clickAllExpandButtons(eduSection);
            await exhaustInfiniteScroll(eduSection);
            const eduItems = eduSection.querySelectorAll('li.pvs-list__paged-list-item, li.artdeco-list__item');
            candidateData.education = Array.from(eduItems).map(item => parseEducationItem(item));
        }
        if (expSection) {
            await clickAllExpandButtons(expSection);
            await exhaustInfiniteScroll(expSection);
            const expItems = expSection.querySelectorAll('li.pvs-list__paged-list-item, li.artdeco-list__item');
            candidateData.experience = Array.from(expItems).map(item => parseExperienceItem(item, candidateData.candidate_name)).filter(Boolean);
        }
        candidateData.skills = await scrapeSkillsSection();
        console.log("✅ All data scraped from single page. Sending to save.");
        chrome.runtime.sendMessage({ type: "SAVE_CANDIDATE_DATA", payload: candidateData });
    }
}

function main() {
    const url = window.location.href;
    console.log(`📍 Content script active on URL: ${url}`);
    if (url.includes('/details/experience')) {
        scrapeExperienceDetailsPage();
    } else if (url.includes('/details/education')) {
        scrapeEducationDetailsPage();
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("📩 Message received in content script:", request.type);
    if (request.type === "START_INITIAL_SCRAPE") {
        planAndScrapeProfile();
        sendResponse({ status: "ok", message: "Initial planning started." });
    } else if (request.type === "SCRAPE_FINAL_SECTIONS") {
        scrapeRemainingSections().then(remainingData => {
            sendResponse({ status: "ok" });
            chrome.runtime.sendMessage({
                type: "FINAL_DATA_SCRAPED",
                payload: remainingData
            });
        });
        return true; 
    }
    return true;
});

main();