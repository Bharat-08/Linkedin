import { createClient } from './lib/supabase.js';
import { GEMINI_API_KEY } from './config.js';



let supabase;
try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log("Supabase client initialized.");
} catch (e) {
    console.error("Failed to initialize Supabase client.", e);
}

let scrapingJobs = {};

async function generateDescription(candidateData) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('YOUR_GEMINI_API_KEY')) {
        console.warn("Gemini API key not set. Skipping description generation.");
        return "Description could not be generated. API key is missing.";
    }
    const prompt = `
You are an expert data formatter. Your task is to take raw JSON data about a professional candidate and reformat it into a clean, human-readable description using Markdown.
Do not write a new summary paragraph or interpret the data. Simply present all the provided data in a structured and organized way under the following headings: Overview, About, Experience, Education, and Skills.
Use bold text for labels (like **Name:** or **Position:**) and bullet points for lists. For the Skills section, list each primary skill and then its nested details.
Here is the candidate's data in JSON format:
${JSON.stringify(candidateData, null, 2)}
Generate the clean description based on these instructions.
`;

    // FIX: Using the latest supported model 'gemini-1.5-flash-latest' with the 'v1beta' endpoint.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`API request failed with status ${response.status}: ${errorBody}`);
        }
        const data = await response.json();
        const description = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Could not parse description from API response.";
        return description.trim();
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        return `Error generating description: ${error.message}`;
    }
}


async function saveToSupabase(payload, sendResponse) {
    if (!supabase) {
        const errorMsg = "Supabase not initialized.";
        console.error(errorMsg);
        if (sendResponse) sendResponse({ status: 'error', message: errorMsg });
        return;
    }
    try {
        const allowedFields = [
            'candidate_name', 'current_title', 'current_company', 'linkedin_url',
            'location_compatibility', 'candidate_description', 'education',
            'experience', 'skills', 'about', 'source'
        ];
        const cleanPayload = {};
        for (const key of allowedFields) {
            if (payload[key] !== undefined) cleanPayload[key] = payload[key];
        }

        if (!Array.isArray(cleanPayload.skills)) cleanPayload.skills = [];
        if (!Array.isArray(cleanPayload.education)) cleanPayload.education = [];
        if (!Array.isArray(cleanPayload.experience)) cleanPayload.experience = [];

        const { data, error } = await supabase.from('candidates').insert([cleanPayload]).select();

        if (error) {
            console.error("Supabase insert error:", error.message);
            if (sendResponse) {
                 if (error.code === '23505') {
                    sendResponse({ status: 'error', message: 'This profile already exists.' });
                } else {
                    sendResponse({ status: 'error', message: `Database error: ${error.message}` });
                }
            }
            return;
        }
        console.log("Data inserted into Supabase:", data);
        if (sendResponse) sendResponse({ status: 'success', message: 'Profile saved successfully!', data });
    } catch (e) {
        console.error("Unexpected insert error:", e);
        if (sendResponse) sendResponse({ status: 'error', message: `Unexpected error: ${e.message}` });
    }
}

function executeNextTask(tabId) {
    const job = scrapingJobs[tabId];
    if (!job) {
        console.error("executeNextTask called but no job found for tabId:", tabId);
        return;
    }
    if (job.taskQueue.length > 0) {
        const nextUrl = job.taskQueue.shift();
        console.log(`🧠 Next task: Navigating to ${nextUrl}`);
        chrome.tabs.update(tabId, { url: nextUrl });
    } else {
        console.log("🧠 Task queue empty. Instructing content script to scrape final sections.");
        chrome.tabs.sendMessage(tabId, { type: "SCRAPE_FINAL_SECTIONS" });
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    if (!tabId) return true;

    const handleMessage = async () => {
        const job = scrapingJobs[tabId];

        switch (request.type) {
            case 'SETUP_SCRAPING_PLAN':
                console.log("🚀 Received SETUP_SCRAPING_PLAN.");
                scrapingJobs[tabId] = {
                    mainProfileData: request.payload.mainProfileData,
                    taskQueue: request.payload.taskQueue,
                    originalUrl: sender.tab.url
                };
                executeNextTask(tabId);
                sendResponse({ status: "ok" });
                break;

            case 'SCRAPED_DETAILS_PAGE':
                console.log(`✅ Received SCRAPED_DETAILS_PAGE for section: ${request.payload.section}`);
                if (!job) return;
                job.mainProfileData[request.payload.section] = request.payload.data;
                
                console.log(`🧠 Returning to main profile: ${job.originalUrl}`);
                chrome.tabs.update(tabId, { url: job.originalUrl }, (tab) => {
                    const listener = (updatedTabId, changeInfo) => {
                        if (updatedTabId === tabId && changeInfo.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(listener);
                            executeNextTask(tabId);
                        }
                    };
                    chrome.tabs.onUpdated.addListener(listener);
                });
                sendResponse({ status: "ok" });
                break;

            case 'FINAL_DATA_SCRAPED':
                console.log(`✅ Received FINAL_DATA_SCRAPED. Assembling final profile.`);
                if (!job) return;

                if (job.mainProfileData.experience.length === 0 && request.payload.experience?.length > 0) {
                    job.mainProfileData.experience = request.payload.experience;
                }
                
                job.mainProfileData.skills = request.payload.skills;
                
                const descriptionMulti = await generateDescription(job.mainProfileData);
                job.mainProfileData.candidate_description = descriptionMulti;
                
                await saveToSupabase(job.mainProfileData, sendResponse);
                delete scrapingJobs[tabId];
                break;
                
            case 'SAVE_CANDIDATE_DATA':
                console.log("Received SAVE_CANDIDATE_DATA (Single Page Scrape)");
                
                const descriptionSingle = await generateDescription(request.payload);
                request.payload.candidate_description = descriptionSingle;

                await saveToSupabase(request.payload, sendResponse);
                break;
        }
    };

    handleMessage();
    return true;
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ status: 'Ready to scrape.' });
    console.log("LinkedIn Scraper extension installed.");
});