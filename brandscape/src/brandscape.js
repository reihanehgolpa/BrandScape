// *** Using Ollama to Query a Web site using URL

import { Ollama } from "ollama";
import { Client } from "@gradio/client";
// Used to download a web site.
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";

// https://js.langchain.com/v0.2/docs/how_to/recursive_text_splitter/
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
// measure embeddings similarity
import similarity from 'compute-cosine-similarity';
import mlDistance from 'ml-distance';




// Interactive prompt — paste right after imports, before creating the loader
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import fs from 'fs';
import dns from 'dns/promises';

console.log("Welcome to BrandScape!\nI'll ask you a few questions to help craft your business name, colour scheme, and logo.\n...\nWhat's your business all about?");

// Default model to use for creative name suggestions (can be overridden via env)
const defaultModel = process.env.BRAND_MODEL || 'llama3.2:3b';

const rl = readline.createInterface({ input, output });
let rawInput = (await rl.question('> ')).trim();
rl.close();

if (!rawInput) {
  console.log('No input received; exiting.');
  process.exit(0);
}

// Limit to up to 5 words
let words = rawInput.split(/\s+/).map(w => w.trim()).filter(Boolean);
if (words.length > 5) {
  console.log('Input contains more than 5 words; truncating to the first 5.');
  words = words.slice(0, 5);
}
const shortBiz = words.join(' ');
const lower = shortBiz.toLowerCase();

// Do not run food/fashion URL mapping. We'll build a contextual query and defer retrieval.
let url = null;
// Number of suggestions to request from the model (keeps prompts and parsing consistent)
const suggestionCount = 5;
// Simple in-memory cache for trademark searches. Declare early so helpers can use it
// even if the helper functions are executed before the later section of the file
// is parsed (avoids TDZ errors when using `const`).
const trademarkCache = new Map();
let query = `Make a list of ${suggestionCount} innovative business ideas for: "${shortBiz}"`;
console.log('Selected input:', shortBiz);

// Ask the model to return the follow-up question exactly once
const followUpQuestion = 'What are the visual elements that best represent your business?';
const followSystem = `You are a concise assistant. Return EXACTLY the following single question line and nothing else: ${followUpQuestion}`;
// We intentionally use a deterministic follow-up question here (avoid calling the
// model before the client/llm settings are initialized). If you want the model
// to craft the follow-up, move that call to after the Ollama client is created.
const followText = followUpQuestion;
console.log('\n' + followText);

// Prompt user to answer with up to two visuals (comma-separated)
const rlVisual = readline.createInterface({ input, output });
let visualsRaw = (await rlVisual.question('> ')).trim();
rlVisual.close();
let visuals = (visualsRaw || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 2);
if (visuals.length === 0) {
  console.log('No visuals provided; proceeding without explicit visuals.');
} else if (visuals.length === 1) {
  console.log('Recorded 1 visual:', visuals[0]);
} else {
  console.log('Recorded visuals:', visuals.join(', '));
}

// Placeholder for any early name suggestions produced at the "All set" step
let earlySuggestedNames = null;

// Ensure Ollama client exists so we can ask the model to return a single-line confirmation.
const ollamaBaseUrl = process.env.OLLAMA_URL || "http://localhost:11434";
// Only include Authorization header when an API key is provided to avoid
// sending an empty Authorization header (which can cause 401 responses).
const _ollamaHeaders = {};
if (process.env.OLLAMA_API_KEY) {
  _ollamaHeaders['Authorization'] = 'Bearer ' + process.env.OLLAMA_API_KEY;
}
const ollama = new Ollama({ host: ollamaBaseUrl, headers: _ollamaHeaders });

// Prompt for brand values (up to 2 free-text choices)
console.log('\nWhat are your brand values?');
const rlBrandFirst = readline.createInterface({ input, output });
let brandChoicesRaw = (await rlBrandFirst.question('> ')).trim();
rlBrandFirst.close();
let brandValues = [];
if (!brandChoicesRaw) {
  console.log('No brand values selected; proceeding without explicit brand values.');
} else {
  // Allow comma-separated values or use 'and' to separate; take up to two entries
  brandValues = brandChoicesRaw.split(/,|\band\b|\//i).map(s => s.trim()).filter(Boolean).slice(0,2);
  if (brandValues.length === 0) {
    // Fallback: take up to two words
    const fallback = brandChoicesRaw.split(/\s+/).filter(Boolean).slice(0,2).join(' ');
    if (fallback) brandValues = [fallback];
  }
  if (brandValues.length > 0) {
    console.log('\nSelected brand values:', brandValues.join(', '));
    console.log('All set! I will generate 5 name recommendations now.');
  }
}

// Update the query to include visuals and brand values when present
if (visuals.length > 0 || brandValues.length > 0) {
  const visualsPart = visuals.length ? ` Visuals: ${visuals.join(', ')}.` : '';
  const brandPart = brandValues.length ? ` Brand values: ${brandValues.join(', ')}.` : '';
  // Use the unified suggestionCount so prompt and parsing expectations match
  query = `Make a list of ${suggestionCount} innovative business names for: "${shortBiz}".${visualsPart}${brandPart}`;
}










const systemTemplate = (context) => `
You are a concise assistant that uses the retrieved context to answer the user's request.

IMPORTANT: Return your final answer as a single JSON object and nothing else. The JSON must have the shape:
{
  "suggestions": [
    { "title": "...", "description": "..." }
  ]
}

Requirements for the JSON output:
- Do NOT include any extra text before or after the JSON.
  - "title" must be a short name (max 2 words).
  - "title" must NOT include any suffixes like "Co", "Co.", "Company", "Inc", "LLC", "Ltd", "Design", "Studio", "Group", "Solutions", or any business entity suffixes.
  - The name should be just the core brand name without any suffix (e.g., "Knit Warming" NOT "Knit Warming Co").
- "description" must be a very short explanation (one sentence, max 20 words) explaining why the name suits the business.
- Do not include markdown, bullets, numbering, or quotation marks around values.
- Do not include markdown, bullets, numbering, or quotation marks around values.

IMPORTANT: The JSON "suggestions" array MUST contain exactly ${suggestionCount} item${suggestionCount===1? '':'s'}.

${context}`;

let data;
if (url) {
  const loader = new CheerioWebBaseLoader(url);
  data = await loader.load();
} else {
  // No URL provided (we're not auto-retrieving). Create a minimal fallback document
  // using the short business description and any visuals the user provided.
  const visualsText = (typeof visuals !== 'undefined' && visuals.length) ? (' ' + visuals.join(' ')) : '';
  data = [{ pageContent: `${shortBiz}${visualsText}` }];
}

// Model used for embedding
const modelEmbedding = {
  model: 'mxbai-embed-large',
  // model: "snowflake-arctic-embed",
  // model: "snowflake-arctic-embed:110m",
  // model: "snowflake-arctic-embed:22m",
  // model: "nomic-embed-text",
}

// Ollama model settings
const llmSettings = {
  model: 'llama3.2:3b',
  // model: 'qwen2.5:1.5b',
  // model: 'granite3-moe',
  // model: "llama3.2:1b",
  // model: "llama3.2:3b",
  // model: "qwen2:latest",
  numCtx: 5000,
};

// Split the text into 500 character chunks. And overlap each chunk by 20 characters
const textSplitter = new RecursiveCharacterTextSplitter({
  // Try different sizes of chunk that better suit your model
  chunkSize: 500,
  chunkOverlap: 20,
});

let splitDocs;
try {
  splitDocs = await textSplitter.splitDocuments(data);
} catch (e) {
  // Fallback: create a single document from the provided data (handles minimal local input)
  console.warn('Text splitter failed, using fallback single-document mode:', e.message);
  splitDocs = (Array.isArray(data) ? data : [data]).map(d => ({ pageContent: d.pageContent || String(d) }));
}

console.log('Show 3 docs of ' + splitDocs.length);
// console.log(JSON.stringify(docs, null, 2));
console.log(splitDocs.slice(0, 3));

console.time('embedding')
const promptEmbedding =  await ollama.embed({
  ...modelEmbedding,
  input: query,
})

// Send all the texts for embeddings at once
const embeddings = await ollama.embed({
  ...modelEmbedding,
  input: splitDocs.map(doc => doc.pageContent)
})

splitDocs.forEach((doc, index) => {
  doc.embedding = embeddings.embeddings[index]
  // similarity with similarity
  // doc.similarity = similarity(promptEmbedding.embeddings[0], doc.embedding)
  // similarity with ml-distance cosine
  doc.similarity = mlDistance.similarity.cosine(promptEmbedding.embeddings[0], doc.embedding)
})

console.timeEnd('embedding')

// Sort by similarity
splitDocs = splitDocs.sort((a, b) => {
  if (a.similarity < b.similarity) {
    return 1;
  }
  if (a.similarity > b.similarity) {
    return -1;
  }
  // a must be equal to b
  return 0;
})

// Use the 5 most similar texts for the context
const context = splitDocs.slice(0, 5)
  .map((doc, index) => `Doc${index}: ${doc.pageContent}`)
  .join(' ')

// console.log(context)

// Using generate via helper (see fetchNameSuggestions below)

// Helper: robustly extract the first JSON object from a text blob
function extractFirstJson(text) {
  if (!text) throw new Error('Empty text');
  try { return JSON.parse(text); } catch (e) { /* fallthrough */ }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('No JSON object found in response');
  }
  const candidate = text.slice(first, last + 1);
  return JSON.parse(candidate);
}

function salvageSuggestionsFromText(text) {
  if (!text) return [];
  const titleRe = /"(\d+\.\s[^"}]+)"\s*,?/g;
  const descRe = /"description"\s*:\s*"([^"]+)"/g;
  const titles = [];
  const descs = [];
  let m;
  while ((m = titleRe.exec(text)) !== null) {
    titles.push(m[1].trim());
    if (titles.length >= 10) break;
  }
  while ((m = descRe.exec(text)) !== null) {
    descs.push(m[1].trim());
    if (descs.length >= 10) break;
  }
  const count = Math.min(titles.length, descs.length);
  const out = [];
  for (let i = 0; i < count && i < 5; i++) {
    out.push({ title: titles[i], description: descs[i] });
  }
  return out;
}

function salvageNamesFromText(text) {
  if (!text) return [];
  const re = /"name"\s*:\s*"([^"]+)"/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1].trim());
    if (out.length >= 10) break;
  }
  if (out.length === 0) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/^[A-Za-z0-9\-\s]{2,40}$/.test(line) && line.length < 40) {
        out.push(line);
        if (out.length >= 10) break;
      }
    }
  }
  return out;
}

function extractTextFromOllamaResult(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (result.output && Array.isArray(result.output) && result.output[0]?.content) return result.output[0].content;
  if (result.choices && result.choices[0]?.message?.content) return result.choices[0].message.content;
  if (typeof result.response === 'string') return result.response;
  if (result.response && typeof result.response === 'object') {
    if (typeof result.response.response === 'string') return result.response.response;
    if (typeof result.response.text === 'string') return result.response.text;
    if (typeof result.response.content === 'string') return result.response.content;
  }
  try {
    const queue = [result];
    while (queue.length) {
      const cur = queue.shift();
      if (!cur || typeof cur !== 'object') continue;
      for (const k of Object.keys(cur)) {
        const v = cur[k];
        if (typeof v === 'string' && v.length > 0) {
          if (v.length < 2000) return v;
        } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          queue.push(v);
        }
      }
    }
  } catch (e) {}
  const sanitized = {};
  if (result.model) sanitized.model = result.model;
  if (result.created_at) sanitized.created_at = result.created_at;
  if (typeof result.response === 'string') sanitized.response = result.response;
  if (result.done !== undefined) sanitized.done = result.done;
  if (result.done_reason) sanitized.done_reason = result.done_reason;
  return JSON.stringify(sanitized);
}

async function fetchNameSuggestions(excludeNames = []) {
  const excludeList = Array.isArray(excludeNames) ? excludeNames.filter(Boolean) : [];
  const recentExclude = excludeList.slice(-25);
  const promptText = recentExclude.length ? `${query} Avoid repeating these exact names: ${recentExclude.join(', ')}.` : query;
  const answer = await ollama.generate({
    ...llmSettings,
    system: systemTemplate(context),
    prompt: promptText,
    temperature: 0,
  });
const rawAnswerText = extractTextFromOllamaResult(answer);

let parsed;
try {
  parsed = extractFirstJson(rawAnswerText);
} catch (err) {
  console.error('Failed to parse JSON from model output:', err.message);
  if (process.env.OLLAMA_DEBUG === '1') {
    console.error('Raw model output (first 400 chars):\n', rawAnswerText.slice(0, 400));
  } else {
    try {
      const dumpPath = `ollama-raw-${Date.now()}.txt`;
      fs.writeFileSync(dumpPath, rawAnswerText, 'utf8');
      console.error(`Raw model output saved to ./${dumpPath}. Set OLLAMA_DEBUG=1 to print it to the console.`);
    } catch (writeErr) {
      console.error('Additionally, failed to save raw model output to disk:', writeErr.message);
    }
  }
  process.exit(1);
}

let suggestions = parsed?.suggestions;
if (!Array.isArray(suggestions) && typeof parsed?.response === 'string') {
  try {
    const inner = extractFirstJson(parsed.response);
    if (inner && Array.isArray(inner.suggestions)) {
      suggestions = inner.suggestions;
      console.warn('Parsed suggestions from nested response string.');
    }
  } catch (e) {
    const salvage = salvageSuggestionsFromText(parsed.response);
    if (salvage.length > 0) {
      suggestions = salvage;
      console.warn(`Salvaged ${salvage.length} suggestion(s) from nested response text.`);
    }
  }
}
if (!Array.isArray(suggestions)) {
  if (Array.isArray(parsed)) {
    suggestions = parsed;
    console.warn('Model returned an array directly — using that as suggestions.');
  } else {
    console.error('Parsed result does not contain "suggestions" array. Parsed value:\n', parsed);
    if (process.env.OLLAMA_DEBUG === '1') {
      console.error('Raw model output (first 400 chars):\n', rawAnswerText.slice(0, 400));
    } else {
      const salvage = salvageSuggestionsFromText(parsed?.response || rawAnswerText);
      if (salvage.length > 0) {
        suggestions = salvage;
        console.warn(`Salvaged ${salvage.length} suggestion(s) from raw model text.`);
      } else {
        try {
          const dumpPath = `ollama-raw-${Date.now()}.txt`;
          fs.writeFileSync(dumpPath, rawAnswerText, 'utf8');
          console.error(`Raw model output saved to ./${dumpPath}. Set OLLAMA_DEBUG=1 to print it to the console.`);
        } catch (writeErr) {
          console.error('Additionally, failed to save raw model output to disk:', writeErr.message);
        }
      }
    }
    if (!Array.isArray(suggestions)) process.exit(1);
  }
}
if (suggestions.length !== suggestionCount) {
  console.warn(`Warning: suggestions array has length ${suggestions.length} (expected ${suggestionCount}).`);
  console.warn('Suggestions (preview):', suggestions.slice(0, suggestionCount).map(s => s?.title || s).join(' | '));
  }
  
  // Post-process to remove any suffixes that might have slipped through
  // Helper function to clean suffixes from names
  const cleanSuffixes = (name) => {
    if (!name) return name;
    let cleaned = String(name).trim();
    // Remove "Branding Co" or "Branding Co." first (before removing just "Co")
    cleaned = cleaned.replace(/\s+Branding\s+Co\.?\s*$/i, '').trim();
    // Remove common suffixes (with space before)
    cleaned = cleaned.replace(/\s+(Co\.?|Company|Inc\.?|LLC|Ltd\.?|Design|Studio|Group|Solutions|Corp\.?|Corporation)\s*$/i, '').trim();
    // Remove standalone "Co" or "Co." at the end (catch any remaining)
    cleaned = cleaned.replace(/\s+Co\.?\s*$/i, '').trim();
    return cleaned;
  };
  
  suggestions = suggestions.map(s => {
    if (s && s.title) {
      s.title = cleanSuffixes(s.title);
    }
    return s;
  });
  
  return suggestions;
}

async function printSuggestionsWithScreening(list) {
  console.log(`\nHere are five name recommendations for your business with domain and trademark screening:\n`);
  
  // Helper function to clean suffixes
  const cleanSuffixes = (name) => {
    if (!name) return name;
    let cleaned = String(name).trim();
    // Remove "Branding Co" or "Branding Co." first (before removing just "Co")
    cleaned = cleaned.replace(/\s+Branding\s+Co\.?\s*$/i, '').trim();
    // Remove common suffixes (with space before)
    cleaned = cleaned.replace(/\s+(Co\.?|Company|Inc\.?|LLC|Ltd\.?|Design|Studio|Group|Solutions|Corp\.?|Corporation)\s*$/i, '').trim();
    // Remove standalone "Co" or "Co." at the end (catch any remaining)
    cleaned = cleaned.replace(/\s+Co\.?\s*$/i, '').trim();
    return cleaned;
  };
  
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    let title = s.title || `(${i+1})`;
    // Clean suffixes before displaying
    title = cleanSuffixes(title);
    const desc = s.description || '';
    
    console.log(`${i + 1}) ${title}`);
    console.log(`   Description: ${desc}`);
    
    // Domain availability check
    try {
      const domainReport = await domainAvailabilityReport(title);
      console.log('   Domain availability:');
      const domains = Object.keys(domainReport);
      if (domains.length > 0) {
        domains.forEach(d => {
          const available = domainReport[d] ? '❌ Taken' : '✅ Available';
          console.log(`      ${d}: ${available}`);
        });
      } else {
        console.log('      No domain check results');
      }
    } catch (e) {
      console.warn('   Domain check failed:', e.message);
    }
    
    // Trademark notes
    try {
      const tm = await trademarkSearchUKExpanded(title);
      if (tm && tm.warnings && tm.warnings.length > 0) {
        console.warn('   Trademark search warnings:', tm.warnings.join(' | '));
      }
      if (!tm) {
        console.log('   Trademark notes: No search results available.');
      } else {
        const notes = await generateTrademarkNotes(title, tm, shortBiz);
        console.log('   Trademark notes:');
        const noteLines = notes.split('\n').filter(l => l.trim());
        noteLines.forEach(line => {
          console.log(`      • ${line.trim()}`);
        });
      }
    } catch (e) {
      console.warn('   Trademark check failed:', e.message);
    }
    
    console.log(''); // Empty line between suggestions
  }
}

const seenSuggestionTitles = new Set();
function trackSuggestionTitles(list) {
  list.forEach(s => {
    const title = (s?.title || '').trim().toLowerCase();
    if (title) seenSuggestionTitles.add(title);
  });
}

async function refreshSuggestionList() {
  console.log('\nRefreshing suggestions...\n');
  const next = await fetchNameSuggestions(Array.from(seenSuggestionTitles));
  trackSuggestionTitles(next);
  return next;
}

const continueLine = 'Type continue for a quick domain and trade mark screening.';
const continueSystem = `You are a strict assistant. Return EXACTLY the following single line and nothing else: ${continueLine}`;
async function getContinuePromptLine() {
  let continueResp;
  try {
    continueResp = await ollama.generate({ ...llmSettings, system: continueSystem, prompt: 'Reply with the single line exactly as specified.', temperature: 0 });
  } catch (e) {
    continueResp = null;
  }
  let continueText = continueResp ? extractTextFromOllamaResult(continueResp).trim() : '';
  if (continueText !== continueLine) continueText = continueLine;
  return continueText;
}

let suggestions = await fetchNameSuggestions();
trackSuggestionTitles(suggestions);

let selected = null;
while (!selected) {
  // Display suggestions with integrated domain and trademark screening
  await printSuggestionsWithScreening(suggestions);
  
  // Prompt user to pick a name or refresh
  console.log('Pick one name or type refresh:');
  const rlPick = readline.createInterface({ input, output });
  let pickRaw = (await rlPick.question('> ')).trim();
  rlPick.close();
  const pickLower = pickRaw.toLowerCase();
  
  if (pickLower.startsWith('refresh')) {
    suggestions = await refreshSuggestionList();
    continue;
  }
  
  const pick = parseInt(pickRaw, 10);
  if (Number.isNaN(pick) || pick < 1 || pick > suggestions.length) {
    console.error(`Invalid selection. Expected a number between 1 and ${suggestions.length} or type "refresh"`);
    continue;
  }
  
  selected = suggestions[pick - 1];
  console.log('\nYou selected:', selected.title);
  break;
}

// After the user picks a name, proceed directly to colours (no yes/no confirmation).
console.log('\nNext up: colours! Here are five colour schemes for your business.');

// store colours chosen (filled by retrieval flow below)
let paletteColors = [];
let paletteColorDetails = [];
let logoPromptText = '';

// Function to generate color recommendations (can be called multiple times for refresh)
async function generateColorRecommendations() {
  // Use the full web-retrieval flow with web search integration to ground colour suggestions
  //: load the Mailchimp page, search web for brand-specific colors, combine, embed, select top-k relevant chunks, then ask the model.
try {
  const sources = [
    'https://mailchimp.com/resources/color-psychology/'
  ];
  let pageDocs = [];
  for (const src of sources) {
    try {
      const loader = new CheerioWebBaseLoader(src);
      const docs = await loader.load();
      if (Array.isArray(docs)) pageDocs.push(...docs);
      else if (docs) pageDocs.push(docs);
    } catch (e) {
      console.warn('Failed to load', src, e.message);
    }
  }

  // Add web search results for colors based on brand values and business description
  if (process.env.SERPAPI_KEY && (brandValues.length > 0 || selected.description)) {
    try {
      console.log('Searching web for colors matching your brand values...');
      const searchQueries = [];
      
      // Create search queries based on brand values
      if (brandValues.length > 0) {
        for (const value of brandValues) {
          searchQueries.push(`"${value}" color psychology brand colors`);
          searchQueries.push(`colors that represent ${value} in branding`);
        }
      }
      
      // Add business-specific color search
      if (selected.description) {
        searchQueries.push(`"${selected.title}" brand colors ${selected.description}`);
      }
      
      // Perform web searches and add results to pageDocs
      for (const query of searchQueries.slice(0, 4)) { // Limit to 4 queries to avoid rate limits
        try {
          const searchRes = await serpAPISearch(query, { maxResults: 3, ukOnly: false });
          if (!searchRes.error && searchRes.body?.organic_results) {
            for (const result of searchRes.body.organic_results) {
              // Create a document from search result
              const searchContent = `${result.title || ''}\n${result.snippet || ''}\n${result.link || ''}`;
              if (searchContent.trim()) {
                pageDocs.push({ pageContent: searchContent });
              }
            }
          }
        } catch (searchErr) {
          // Continue with other queries if one fails
          console.warn(`Web search query failed: ${query}`, searchErr.message);
        }
      }
    } catch (webSearchErr) {
      console.warn('Web search for colors failed, continuing with static sources:', webSearchErr.message);
    }
  }

  if (!Array.isArray(pageDocs) || pageDocs.length === 0) {
    console.warn('No documents loaded from web-retrieval sources; proceeding with empty context.');
    pageDocs = [{ pageContent: '' }];
  }

  // split the page into chunks using the same splitter used earlier
  let splitDocsColor = await textSplitter.splitDocuments(pageDocs);
  if (!Array.isArray(splitDocsColor) || splitDocsColor.length === 0) splitDocsColor = (Array.isArray(pageDocs) ? pageDocs : [pageDocs]).map(d => ({ pageContent: d.pageContent || '' }));

  // create a short embedding query that describes what we want from the page
  const brandValuesText = brandValues.length > 0 ? ` Brand values: ${brandValues.join(', ')}.` : '';
  const brandValuesTextForPrompt = brandValues.length > 0 ? `\nBrand values: ${brandValues.join(', ')}` : '';
  const colorQuery = `color psychology and associations for a business named "${selected.title}" ${selected.description ? ('- ' + selected.description) : ''}${brandValuesText}`;
  const colorPromptEmbedding = await ollama.embed({ ...modelEmbedding, input: colorQuery });

  // embed each chunk and compute cosine similarity to the query
  const chunkEmbeddings = await ollama.embed({ ...modelEmbedding, input: splitDocsColor.map(d => d.pageContent) });
  splitDocsColor.forEach((doc, i) => {
    doc.embedding = chunkEmbeddings.embeddings[i];
    doc.similarity = mlDistance.similarity.cosine(colorPromptEmbedding.embeddings[0], doc.embedding);
  });

  // pick top 5 most similar chunks as context
  splitDocsColor = splitDocsColor.sort((a,b) => (b.similarity || 0) - (a.similarity || 0)).slice(0, 5);
  const colorContext = splitDocsColor.map((d, i) => `Doc${i}: ${d.pageContent}`).join('\n\n');

  const colorSystem = `You are a color psychology expert that uses the retrieved web context to recommend colors for a brand. Use the web search context provided to explain WHY these colors suit the specific business and brand values. Provide detailed, full-sentence explanations based on color psychology research from the context.`;
  // Request FIVE complementary colour pairs with DIVERSITY across the color spectrum. Each line should contain two HEX values,
  // a human-friendly pair name, and a full sentence explanation based on web search context.
  const colorUser = `Context from web search and color psychology:\n${colorContext}\n\nBusiness name: "${selected.title}"\nShort description: "${selected.description || ''}"${brandValuesTextForPrompt}\n\nReturn EXACTLY FIVE NON-EMPTY LINES and nothing else. EACH LINE MUST MATCH THIS EXACT FORMAT: HEX1,HEX2 - COLOR_NAME_PAIR - full sentence explanation. Use HEX in UPPERCASE. 

CRITICAL: Ensure DIVERSITY across the color spectrum. The five color pairs should cover different color families:
- Include warm colors (reds, oranges, yellows) in at least one pair
- Include cool colors (blues, greens, purples) in at least one pair  
- Include neutral/earthy tones (browns, grays, beiges) if appropriate
- Vary saturation levels (some vibrant, some muted)
- Vary brightness levels (some light, some dark)
- Each pair should be visually distinct from the others
- Avoid repeating similar color combinations

The explanation must be a complete sentence (15-30 words) that explains WHY these colors suit this specific business and brand values, referencing color psychology principles from the web search context. Example: #1A73E8,#E83E1A - Deep Blue & Warm Coral - Deep blue conveys trust and professionalism which aligns with your brand's reliability, while warm coral adds energy and approachability that makes customers feel welcomed and valued. Prioritize colors that align with the brand values and explain the connection clearly. Do NOT include the business name, labels, bullets, or extra commentary.`;

  function validateFivePairLines(lines) {
    if (!Array.isArray(lines) || lines.length !== 5) return false;
    // HEX1,HEX2 - Name Pair - full sentence explanation (allows longer explanations up to 500 chars).
    const re = /^#([0-9A-F]{6})\s*,\s*#([0-9A-F]{6})\s*-\s*([^\-]{3,80})\s*-\s*(.{15,500})$/i;
    return lines.every(l => re.test(l));
  }

  function parseFivePairLine(ln) {
    const parts = ln.split(/\s*-\s*/);
    const hexPart = parts[0] || '';
    const namesPart = parts[1] || '';
    const reasonPart = parts[2] || '';
    const hexes = hexPart.split(',').map(h => h.trim().toUpperCase());
    let nameParts = namesPart.split(/\s*&\s*|\s+and\s+/i).map(n => n.trim());
    if (nameParts.length < 2) nameParts = namesPart.split(/\s*,\s*/).map(n => n.trim());
    return {
      hex1: hexes[0] || '',
      hex2: hexes[1] || '',
      namePair: namesPart || '',
      name1: nameParts[0] || '',
      name2: nameParts[1] || '',
      short: reasonPart || '',
      long: '',
      raw: ln,
    };
  }

  // Attempt up to 3 times to get properly formatted five pairs
  let attempts = 0;
  let colorText = '';
  let colorLines = [];
  while (attempts < 3) {
    const colorResp = await ollama.generate({ ...llmSettings, system: colorSystem, prompt: colorUser, temperature: 0.7 });
    colorText = extractTextFromOllamaResult(colorResp).trim();
    colorLines = (colorText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0,5);
    if (validateFivePairLines(colorLines)) break;
    attempts++;
    console.warn(`Colour pair format validation failed (attempt ${attempts}). Retrying...`);
  }

  if (colorLines.length === 0) {
    console.warn('Model did not return valid colour pair lines; falling back to default pairs.');
    paletteColors = [
      `#0B5394,#F4B183 - Deep Navy & Warm Apricot - Trustworthy and approachable.`,
      `#18AF6E,#FF6F61 - Forest Green & Coral - Growth with friendly warmth.`,
      `#F1C232,#6D9EEB - Goldenrod & Sky Blue - Optimistic and modern.`,
      `#2C3E50,#F7DC6F - Slate & Warm Yellow - Calm and optimistic.`,
      `#7F3FBF,#FFD166 - Purple & Soft Gold - Creative and confident.`
    ];
    paletteColorDetails = paletteColors.map(parseFivePairLine);
    paletteColorDetails.forEach((c, idx) => console.log(`${idx+1}) ${c.hex1},${c.hex2} - ${c.namePair} - ${c.short}`));
  } else {
    paletteColors = colorLines.slice(0,5);
    paletteColorDetails = paletteColors.map(parseFivePairLine);
    paletteColorDetails.forEach((c, idx) => console.log(`${idx+1}) ${c.hex1},${c.hex2} - ${c.namePair} - ${c.short}`));
  }
  return paletteColorDetails;
} catch (e) {
  console.warn('Colour suggestion failed (retrieval flow):', e.message);
  paletteColors = [
    `#18AF6E - ${selected.title} - Conveys growth and trust.`,
    `#FF9900 - ${selected.title} - Energetic and friendly.`
  ];
  console.log('1) ' + paletteColors[0]);
  console.log('2) ' + paletteColors[1]);
    // Return empty array on error, caller can handle fallback
    return [];
  }
}

// Generate initial color recommendations
paletteColorDetails = await generateColorRecommendations();
if (paletteColorDetails.length === 0) {
  // Fallback if generation failed
  paletteColorDetails = [];
}

// Prompt the user to pick one of the shown palettes and immediately show a
// concise logo prompt based on that choice.
let pickedPalette = null;
while (!pickedPalette) {
  console.log('\nPick one of the above palettes or type refresh:');
const rlPickPalette = readline.createInterface({ input, output });
let pickPalRaw = (await rlPickPalette.question('> ')).trim();
rlPickPalette.close();

  const pickLower = pickPalRaw.toLowerCase();
  if (pickLower.startsWith('refresh')) {
    console.log('\nRegenerating color recommendations...');
    // Regenerate colors by calling the function again
    paletteColorDetails = await generateColorRecommendations();
    if (paletteColorDetails.length === 0) {
      console.warn('Failed to regenerate colors. Please try again or pick from existing options.');
      continue;
    }
    // Continue the loop to show the new options and prompt again
    continue;
  }
  
  // Try to parse as a number
let pickPal = parseInt(pickPalRaw, 10);
  if (Number.isNaN(pickPal) || pickPal < 1) {
    console.warn('Invalid input. Please enter a number 1-5 or type "refresh".');
    continue;
  }
  
if (!Array.isArray(paletteColorDetails) || paletteColorDetails.length === 0) {
  console.warn('No palette details available to pick from.');
    break;
  }
  
  if (pickPal > paletteColorDetails.length) {
    console.warn(`Please enter a number between 1 and ${paletteColorDetails.length}.`);
    continue;
  }
  
  pickedPalette = paletteColorDetails[pickPal - 1];
  break;
}

if (pickedPalette) {
  // Announce and show a quick logo prompt preview using the picked palette
  console.log('\nLet\'s move on to the logo. Here a logo prompt based on your preferences:');
  const nameForLogo = (selected && selected.title) ? selected.title : shortBiz;
  const descForLogo = (selected && selected.description) ? selected.description : '';
  // Narrow palette variables so later logo-generation uses the selected palette
  paletteColors = [`${pickedPalette.hex1},${pickedPalette.hex2} - ${pickedPalette.namePair} - ${pickedPalette.short}`];
  paletteColorDetails = [pickedPalette];
  try {
    const logoSystem = `You are an expert logo prompt writer. Return ONLY a concise paragraph (2-4 sentences, maximum 80 words) describing ONLY the visual appearance of a minimal mark. The PRIMARY focus must be the visual elements provided by the user. If the user specifies visual elements (e.g., "knitting needle"), the logo MUST feature those elements as the main subject. Describe ONLY: the visual elements (as the central focus), shapes, lines, geometric forms, colors (use exact HEX codes), and style (flat vector, white background). Do NOT include: business name, wordmark, emotional language, what the logo "conveys" or "evokes", brand values, or any descriptive notes about meaning. Only describe what the logo looks like visually, with the user's visual elements as the primary subject.`;
  // Prefer the picked palette's hex values when available
  let hexA = '#000000';
  let hexB = '#FFFFFF';
  if (Array.isArray(paletteColorDetails) && paletteColorDetails[0]) {
    hexA = paletteColorDetails[0].hex1 || hexA;
    hexB = paletteColorDetails[0].hex2 || hexB;
  } else if (Array.isArray(paletteColors) && paletteColors[0]) {
    try {
      const p = paletteColors[0].split('-')[0].trim();
      const parts = p.split(',').map(s => s.trim());
      if (parts[0]) hexA = parts[0];
      if (parts[1]) hexB = parts[1];
      } catch (err) {
        // ignore parse issues
      }
    }
    // Normalize HEX strings: ensure leading '#' and uppercase; validate as #RRGGBB.
    const normalizeHex = (h) => {
      if (!h) return null;
      let s = String(h).trim();
      if (!s.startsWith('#')) s = '#' + s;
      s = s.toUpperCase();
      if (/^#[0-9A-F]{6}$/.test(s)) return s;
      return null;
    };
    const hexAclean = normalizeHex(hexA) || String(hexA || '').toUpperCase();
    const hexBclean = normalizeHex(hexB) || String(hexB || '').toUpperCase();
    const visualsForLogo = (visuals && visuals.length > 0) ? visuals.join(', ') : '';
    const logoUser = `Business type: ${descForLogo}\nVisual elements: ${visualsForLogo || 'none specified'}\nColors: ${hexAclean} (primary), ${hexBclean} (accent)\n\nCRITICAL: The logo MUST feature the visual elements listed above as the PRIMARY and CENTRAL subject. If visual elements are provided (e.g., "knitting needle"), describe a logo that prominently features those elements. Describe ONLY the visual appearance: the visual elements as the main subject, shapes, lines, forms, and how colors ${hexAclean} and ${hexBclean} are applied to these elements. Include the exact HEX codes. Do NOT describe what the logo means, conveys, or evokes. Only describe what it looks like, with the visual elements as the focus. Maximum 80 words.`;
    let logoResp = await ollama.generate({ ...llmSettings, system: logoSystem, prompt: logoUser, temperature: 0 });
    let logoText = extractTextFromOllamaResult(logoResp).trim();
    // Verify HEX codes are included, retry once if missing
    const hasHexA = hexAclean && logoText.toUpperCase().includes(hexAclean.toUpperCase());
    const hasHexB = hexBclean && logoText.toUpperCase().includes(hexBclean.toUpperCase());
    if (!(hasHexA && hasHexB)) {
      const logoUserStrict = logoUser + `\n\nIMPORTANT: Include the exact HEX codes ${hexAclean} and ${hexBclean} in your response.`;
      try {
        logoResp = await ollama.generate({ ...llmSettings, system: logoSystem, prompt: logoUserStrict, temperature: 0 });
        logoText = extractTextFromOllamaResult(logoResp).trim();
      } catch (retryErr) {
        // ignore retry failure and keep original text
      }
    }
  console.log(logoText);
    logoPromptText = logoText;
  } catch (e) {
    console.warn('Logo prompt preview generation failed:', e.message);
    logoPromptText = logoLines.join('\n');
  }
}

async function domainAvailabilityReport(name) {
  const raw = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!raw) return {};
  const parts = raw.split(/\s+/).filter(Boolean);
  const compact = parts.join('');
  
  // If name contains "&", use "and" variant instead of compact version
  const hasAmpersand = (name || '').includes('&');
  let basesToCheck = [];
  
  if (hasAmpersand) {
    // Replace "&" with "and" and create domain base
    const withAnd = (name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
    const partsWithAnd = withAnd.split(/\s+/).filter(Boolean);
    const compactWithAnd = partsWithAnd.join('');
    if (compactWithAnd) {
      basesToCheck = [compactWithAnd]; // Only check "and" variant for names with "&"
    } else {
      basesToCheck = [compact]; // Fallback if "and" variant fails
    }
  } else {
    // No "&" in name, use compact version
    basesToCheck = [compact];
  }
  
  const uniqueBases = Array.from(new Set(basesToCheck.filter(Boolean)));
  const tlds = ['com', 'co.uk', 'uk'];
  const results = {};
  for (const base of uniqueBases) {
    for (const tld of tlds) {
      const domain = `${base}.${tld}`;
      try {
        await dns.resolve(domain);
        results[domain] = true;
      } catch (err) {
        results[domain] = false;
      }
    }
  }
  return results;
}

// SerpAPI integration for web searches
async function serpAPISearch(query, opts = {}) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return { error: 'SERPAPI_KEY not set' };
  
  const params = new URLSearchParams({
    q: query,
    api_key: key,
    engine: 'google',
    num: opts.maxResults || 10,
  });
  
  // Add location for UK-focused searches
  if (opts.ukOnly !== false) {
    params.append('gl', 'uk'); // Country code
    params.append('hl', 'en'); // Language
  }
  
  try {
    if (typeof fetch !== 'function') return { error: 'fetch not available' };
    const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    if (!res.ok) return { error: `SerpAPI status ${res.status}` };
    const body = await res.json();
    return { source: 'serpapi', body };
  } catch (e) {
    return { error: e.message };
  }
}

// SerpAPI reverse image search for logo screening
async function serpAPIImageSearch(imageUrl, opts = {}) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return { error: 'SERPAPI_KEY not set' };
  
  const params = new URLSearchParams({
    engine: 'google_lens',
    url: imageUrl,
    api_key: key,
  });
  
  if (opts.ukOnly !== false) {
    params.append('gl', 'uk');
    params.append('hl', 'en');
  }
  
  try {
    if (typeof fetch !== 'function') return { error: 'fetch not available' };
    const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    if (!res.ok) return { error: `SerpAPI status ${res.status}` };
    const body = await res.json();
    return { source: 'serpapi_images', body };
  } catch (e) {
    return { error: e.message };
  }
}

// Generate trademark notes by analyzing search results with LLM
// Simple phonetic similarity check - returns true if words sound similar
function soundsSimilar(word1, word2) {
  if (!word1 || !word2) return false;
  const w1 = word1.toLowerCase().replace(/[^a-z]/g, '');
  const w2 = word2.toLowerCase().replace(/[^a-z]/g, '');
  if (w1 === w2) return true;
  
  // Check if one contains the other (e.g., "purlfect" contains "purl")
  if (w1.includes(w2) || w2.includes(w1)) return true;
  
  // Check for common phonetic variations
  const variations = [
    [w1.replace(/ph/g, 'f'), w2], [w1, w2.replace(/ph/g, 'f')],
    [w1.replace(/ck/g, 'k'), w2], [w1, w2.replace(/ck/g, 'k')],
    [w1.replace(/x/g, 'ks'), w2], [w1, w2.replace(/x/g, 'ks')],
  ];
  return variations.some(([v1, v2]) => v1 === v2 || v1.includes(v2) || v2.includes(v1));
}

async function generateTrademarkNotes(name, searchResults, businessContext = '') {
  if (!searchResults || !searchResults.hits || searchResults.hits.length === 0) {
    return 'The exact name "' + name + '" was not found as a registered trademark in the web search results.\n\nDISCLAIMER: This is not a legal clearance.';
  }

  // Normalize the name for comparison (lowercase, remove extra spaces)
  const normalizedName = name.toLowerCase().trim().replace(/\s+/g, ' ');
  const nameWords = normalizedName.split(/\s+/).filter(w => w.length > 2); // Get significant words (3+ chars)
  
  // Normalize business context for matching
  const contextLower = (businessContext || '').toLowerCase();
  const contextWords = contextLower.split(/\s+/).filter(w => w.length > 3); // Get significant context words
  
  // Check if the exact name appears in any search results
  const exactMatches = searchResults.hits.filter(h => {
    const title = (h.title || '').toLowerCase();
    const snippet = (h.snippet || '').toLowerCase();
    const combined = title + ' ' + snippet;
    
    // Check if the exact name appears in the title or snippet
    return combined.includes(normalizedName);
  });

  // Check specifically for UK IPO (official trademark database) results
  const ipoHits = searchResults.hits.filter(h => {
    const url = (h.url || '').toLowerCase();
    const title = (h.title || '').toLowerCase();
    const snippet = (h.snippet || '').toLowerCase();
    const combined = title + ' ' + snippet;
    
    return (url.includes('ipo.gov.uk') || url.includes('gov.uk')) && 
           combined.includes(normalizedName);
  });

  // Check for similar names in trademark-related results
  const similarNameMatches = [];
  if (nameWords.length > 0) {
    for (const hit of searchResults.hits) {
      const title = (hit.title || '').toLowerCase();
      const snippet = (hit.snippet || '').toLowerCase();
      const combined = title + ' ' + snippet;
      const url = (hit.url || '').toLowerCase();
      
      // Check if this is trademark-related
      const isTrademarkRelated = combined.includes('trademark') || 
                                 combined.includes('trade mark') ||
                                 url.includes('ipo.gov.uk') ||
                                 url.includes('trademark');
      
      if (!isTrademarkRelated) continue;
      
      // Skip if it's an exact match (already handled above)
      if (combined.includes(normalizedName)) continue;
      
      // Check if it contains similar words from the name (exact or phonetic match)
      const matchingWords = nameWords.filter(word => {
        // Check for exact word match
        if (combined.includes(word)) return true;
        // Check for phonetic similarity (e.g., "purlfect" vs "perfect")
        const wordsInText = combined.split(/\s+/);
        return wordsInText.some(textWord => soundsSimilar(word, textWord));
      });
      
      // Calculate similarity threshold for confusion risk:
      // - For multi-word names: require at least 2 words OR 50% of words to match
      // - For single-word names: require the word itself (handled by exact match check)
      // - Exception: 1 word match + same business context = still report (higher confusion risk)
      const wordMatchRatio = nameWords.length > 0 ? matchingWords.length / nameWords.length : 0;
      const hasContextMatch = contextWords.length > 0 && 
                              contextWords.some(ctxWord => combined.includes(ctxWord));
      
      // Determine if this is confusingly similar enough to report
      const isConfusinglySimilar = matchingWords.length >= 1 && matchingWords.length < nameWords.length && (
        matchingWords.length >= 2 ||                    // 2+ words match
        wordMatchRatio >= 0.5 ||                        // 50%+ of words match
        (matchingWords.length >= 1 && hasContextMatch)  // 1 word + same business context
      );
      
      if (isConfusinglySimilar) {
        
        // Extract potential similar name from title or snippet
        let similarName = '';
        
        // Try to extract from title first (cleaner)
        if (title && title.length < 150) {
          // Remove common trademark-related words and phrases
          const cleanedTitle = title
            .replace(/\btrademark\b/gi, '')
            .replace(/\btrade\s+mark\b/gi, '')
            .replace(/\bipo\b/gi, '')
            .replace(/\bsearch\b/gi, '')
            .replace(/\bresults?\b/gi, '')
            .replace(/\bfor\b/gi, '')
            .replace(/\bthe\b/gi, '')
            .replace(/[:\-–—]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          // Only use if it looks like a name (has at least one matching word from the original name, exact or phonetic)
          if (cleanedTitle.length > 2 && cleanedTitle.length < 60) {
            const titleWords = cleanedTitle.toLowerCase().split(/\s+/);
            const hasNameWord = matchingWords.some(mw => 
              titleWords.some(tw => 
                tw.includes(mw.toLowerCase()) || 
                mw.toLowerCase().includes(tw) || 
                soundsSimilar(mw, tw)
              )
            );
            if (hasNameWord) {
              similarName = cleanedTitle;
            }
          }
        }
        
        // If no name from title, try to extract from snippet
        if (!similarName && snippet) {
          // Try quoted names first (most reliable)
          const quotedPattern = /"([^"]{3,50})"/g;
          let quotedMatch;
          while ((quotedMatch = quotedPattern.exec(snippet)) !== null) {
            const quotedName = quotedMatch[1];
            // Check if quoted name contains at least one matching word (exact or phonetic)
            const quotedLower = quotedName.toLowerCase();
            const quotedWords = quotedLower.split(/\s+/);
            if (matchingWords.some(mw => 
              quotedLower.includes(mw.toLowerCase()) || 
              quotedWords.some(qw => soundsSimilar(mw, qw))
            )) {
              similarName = quotedName;
              break;
            }
          }
          
          // If still no name, try to find capitalized phrases that might be a name
          if (!similarName) {
            const capitalizedPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
            let capMatch;
            while ((capMatch = capitalizedPattern.exec(snippet)) !== null) {
              const capName = capMatch[1];
              if (capName.length >= 3 && capName.length < 50) {
                const capLower = capName.toLowerCase();
                const capWords = capLower.split(/\s+/);
                // Check if it contains at least one matching word (exact or phonetic)
                if (matchingWords.some(mw => 
                  capLower.includes(mw.toLowerCase()) || 
                  capWords.some(cw => soundsSimilar(mw, cw))
                )) {
                  similarName = capName;
                  break;
                }
              }
            }
          }
        }
        
        // Only add if we found a meaningful similar name (not generic)
        // Also allow if there's a strong context match with multiple matching words
        if (similarName && similarName.length > 2 && similarName !== 'similar name') {
          similarNameMatches.push({
            name: similarName,
            context: hasContextMatch,
            snippet: snippet.substring(0, 120),
            url: url
          });
        } else if (hasContextMatch && matchingWords.length >= 2) {
          // If strong context match with multiple words, use the matching words as the name
          similarNameMatches.push({
            name: matchingWords.join(' '),
            context: hasContextMatch,
            snippet: snippet.substring(0, 120),
            url: url
          });
        }
      }
    }
  }

  // Build notes: 1) Exact match status, 2) Similar names, 3) Cautionary note
  const notes = [];

  // Note 1: Exact match status
  if (ipoHits.length > 0) {
    notes.push('The exact name "' + name + '" was found as a registered trademark in the UK IPO (Intellectual Property Office) database search results.');
  } else if (exactMatches.length > 0) {
    notes.push('The exact name "' + name + '" was found in trademark-related search results, but not confirmed in official UK IPO records.');
  } else {
    notes.push('The exact name "' + name + '" was not found as a registered trademark in the web search results.');
  }

  // Note 2: Similar names (if found)
  // Filter out any generic or meaningless names
  const validSimilarNames = similarNameMatches.filter(m => {
    const name = (m.name || '').trim().toLowerCase();
    return name.length > 2 && 
           name !== 'similar name' && 
           !name.includes('trademark') && 
           !name.includes('search') &&
           !name.includes('result');
  });
  
  if (validSimilarNames.length > 0) {
    const contextMatches = validSimilarNames.filter(m => m.context);
    if (contextMatches.length > 0) {
      const similarName = contextMatches[0].name;
      notes.push(`Found similar name "${similarName}" in trademark-related results within the same business context.`);
    } else {
      const similarName = validSimilarNames[0].name;
      notes.push(`Found similar name "${similarName}" in trademark-related results.`);
    }
  }

  // Note 3: Short cautionary note
  notes.push('DISCLAIMER: This is not a legal clearance.');

  return notes.join('\n\n');
}

// Best-effort UK trademark search using SerpAPI (or Ollama webSearch as fallback).
// This is NOT a legal clearance. It returns raw web-search hits that mention trademarks.
async function trademarkSearchUK(name) {
  const q = `"${name}" trademark UK OR "trade mark" OR site:ipo.gov.uk`;
  
  // Try SerpAPI first
  if (process.env.SERPAPI_KEY) {
    try {
      const serpRes = await serpAPISearch(q, { maxResults: 6, ukOnly: true });
      if (!serpRes.error && serpRes.body?.organic_results) {
        return {
          results: serpRes.body.organic_results.map(r => ({
            title: r.title || '',
            url: r.link || '',
            snippet: r.snippet || '',
          })),
          source: 'serpapi',
        };
      }
    } catch (e) {
      // Fall through to Ollama webSearch if SerpAPI fails
    }
  }
  
  // Fallback to Ollama webSearch if available
  try {
    if (typeof ollama.webSearch === 'function') {
    const res = await ollama.webSearch({ query: q, max_results: 6 });
    return res;
    }
    return { error: 'No search provider available (set SERPAPI_KEY or enable ollama.webSearch)' };
  } catch (e) {
    return { error: e.message };
  }
}

// --- Expanded trademark search (webSearch + optional WhoisXMLAPI + caching) ---

async function callWhoisXmlTrademark(name) {
  const key = process.env.WHOISXMLAPI_KEY;
  if (!key) return { error: 'no_api_key' };
  const q = encodeURIComponent(name);
  // Example WhoisXMLAPI endpoint - consult provider docs for exact path and params
  const url = `https://www.whoisxmlapi.com/whoisserver/TrademarksSearch?apiKey=${key}&searchTerm=${q}&limit=10`;
  try {
    if (typeof fetch !== 'function') return { error: 'fetch not available' };
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return { error: `whoisxml status ${res.status}` };
    const body = await res.json();
    return { source: 'whoisxml', body };
  } catch (e) {
    return { error: e.message };
  }
}

// Screen a logo image for similar trademarks using reverse image search
async function logoTrademarkScreen(imageUrl, opts = {}) {
  const key = `logo:${imageUrl}`;
  const ttlMs = (opts.ttlMinutes || 10) * 60 * 1000;
  const now = Date.now();
  const cached = trademarkCache.get(key);
  if (cached && (now - cached.ts) < ttlMs) return cached.value;

  const out = { summary: [], hits: [], warnings: [] };

  if (process.env.SERPAPI_KEY) {
    try {
      const imgRes = await serpAPIImageSearch(imageUrl, { ukOnly: opts.ukOnly !== false });
      if (!imgRes.error && imgRes.body) {
        // Parse Google Lens results
        const visualMatches = imgRes.body?.visual_matches || [];
        const knowledgeGraph = imgRes.body?.knowledge_graph;
        
        for (const match of visualMatches) {
          out.hits.push({
            source: 'serpapi_images',
            title: match.title || '',
            url: match.link || '',
            snippet: match.source || '',
            thumbnail: match.thumbnail || '',
            raw: match,
          });
        }
        
        if (knowledgeGraph) {
          out.summary.push(`Found knowledge graph data: ${knowledgeGraph.title || 'N/A'}`);
        }
      } else if (imgRes.error) {
        out.warnings.push(`SerpAPI image search failed: ${imgRes.error}`);
      }
    } catch (e) {
      out.warnings.push(`Logo image search failed: ${String(e.message || e)}`);
    }
  } else {
    out.warnings.push('SERPAPI_KEY not set; cannot perform reverse image search for logo screening.');
  }

  trademarkCache.set(key, { ts: Date.now(), value: out });
  return out;
}

// EUIPO (European Union Intellectual Property Office) API integration
// Note: EUIPO database includes UK trademarks (even post-Brexit, historical data remains)
// Uses EUIPO eSearch public interface
async function searchEUIPOAPI(name, opts = {}) {
  try {
    if (typeof fetch !== 'function') {
      return { error: 'fetch not available' };
    }
    
    // EUIPO eSearch uses a POST request with JSON body
    // Search for exact name match in UK and EU trademarks
    const searchUrl = 'https://euipo.europa.eu/eSearch/api/search/trademark';
    const searchBody = {
      query: name,
      rows: opts.maxResults || 20,
      start: 0,
      filters: {
        // Optionally filter for UK if needed (though UK data is included in EUIPO)
      }
    };
    
    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'BrandScape/1.0'
      },
      body: JSON.stringify(searchBody)
    });
    
    if (!response.ok) {
      // If POST fails, try GET as fallback
      const getUrl = `https://euipo.europa.eu/eSearch/api/search/trademark?query=${encodeURIComponent(name)}&rows=${opts.maxResults || 20}`;
      const getResponse = await fetch(getUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'BrandScape/1.0'
        }
      });
      
      if (!getResponse.ok) {
        return { error: `EUIPO API status ${getResponse.status}` };
      }
      
      const data = await getResponse.json();
      return transformEUIPOResults(data, name);
    }
    
    const data = await response.json();
    return transformEUIPOResults(data, name);
  } catch (e) {
    return { error: e.message };
  }
}

// Helper to transform EUIPO API results to our format
function transformEUIPOResults(data, searchName) {
  const hits = [];
  
  // EUIPO API response structure may vary - handle different formats
  const results = data.results || data.data || data.items || [];
  
  for (const result of results) {
    const markName = result.markText || result.name || result.trademarkName || searchName;
    const markId = result.id || result.trademarkId || result.applicationNumber;
    const status = result.status || result.markStatus || 'Unknown';
    const classes = result.classes || result.niceClasses || [];
    const owner = result.owner || result.applicant || '';
    
    hits.push({
      source: 'euipo_api',
      title: markName,
      url: markId ? `https://euipo.europa.eu/eSearch/#details/trademarks/${markId}` : 'https://euipo.europa.eu/eSearch/',
      snippet: `Status: ${status}${classes.length > 0 ? ` | Classes: ${classes.join(', ')}` : ''}${owner ? ` | Owner: ${owner}` : ''}`,
      raw: result
    });
  }
  
  return { hits, data };
}

// UK IPO integration
// Note: UK IPO doesn't have a public REST API, so we use web scraping
// If UK IPO releases an official API in the future, this function can be updated
async function searchUKIPOAPI(name, opts = {}) {
  try {
    // Check if web scraping is enabled (set UK_IPO_WEB_SCRAPING=true in .env to enable)
    // Default to false to respect UK IPO terms of service
    const enableWebScraping = process.env.UK_IPO_WEB_SCRAPING === 'true';
    
    if (!enableWebScraping) {
      // Return info instead of error - this is expected behavior
      return { 
        info: 'UK IPO web scraping disabled (set UK_IPO_WEB_SCRAPING=true in .env to enable). Using EUIPO API which includes UK trademark data.',
        hits: [] // Return empty hits, not an error
      };
    }
    
    // Use web scraping as fallback
    const webResults = await searchUKIPOWeb(name, opts);
    
    if (webResults.error) {
      return { 
        error: `UK IPO web search: ${webResults.error}`,
        hits: []
      };
    }
    
    return webResults;
    
    // Future: If UK IPO releases an official API, uncomment and implement:
    // const apiKey = process.env.UK_IPO_API_KEY;
    // if (!apiKey) return { error: 'UK_IPO_API_KEY not set' };
    // 
    // const url = `https://api.ipo.gov.uk/v1/trademarks/search?q=${encodeURIComponent(name)}`;
    // const response = await fetch(url, {
    //   headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
    // });
    // ... process results
  } catch (e) {
    return { error: e.message, hits: [] };
  }
}

// UK IPO web scraping (since no public API is available)
// Note: UK IPO uses https://www.ipo.gov.uk/tmtext for trademark searches
// This function scrapes the search results page
// IMPORTANT: Check UK IPO terms of service before using in production
async function searchUKIPOWeb(name, opts = {}) {
  try {
    // UK IPO trademark text search URL
    const searchUrl = `https://www.ipo.gov.uk/tmtext?textquery=${encodeURIComponent(name)}`;
    
    // Use CheerioWebBaseLoader to fetch and parse HTML
    const loader = new CheerioWebBaseLoader(searchUrl);
    const docs = await loader.load();
    
    if (!docs || docs.length === 0) {
      return { error: 'No content retrieved from UK IPO' };
    }
    
    // Combine all document content
    const htmlContent = docs.map(d => d.pageContent).join('\n');
    
    // Parse the HTML using Cheerio (loader already loaded it)
    // We need to access the Cheerio instance - the loader uses it internally
    // For now, parse the text content for trademark information
    
    const hits = [];
    
    // UK IPO search results typically contain:
    // - Trademark name
    // - Application/Registration number
    // - Status
    // - Owner/Applicant
    // - Classes
    
    // Pattern matching for UK IPO result format
    // This is a simplified parser - UK IPO HTML structure may change
    const lines = htmlContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let currentTrademark = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      
      // Look for trademark indicators
      if (line.includes('trade mark') || line.includes('trademark') || line.includes('application number')) {
        // Try to extract trademark name (usually appears before or after these keywords)
        const nameMatch = lines[i].match(/"([^"]+)"/) || 
                         lines[i].match(/(?:name|mark):\s*([^\n,]+)/i) ||
                         (i > 0 && lines[i-1].length > 3 && lines[i-1].length < 100 ? lines[i-1] : null);
        
        if (nameMatch || (i > 0 && lines[i-1])) {
          const markName = nameMatch ? nameMatch[1] || nameMatch[0] : lines[i-1];
          const appNumMatch = lines[i].match(/(?:application|registration)\s*(?:number|no)[:\s]+([A-Z0-9]+)/i);
          const appNum = appNumMatch ? appNumMatch[1] : null;
          
          if (markName && markName.length > 2) {
            hits.push({
              source: 'uk_ipo_web',
              title: markName,
              url: appNum ? `https://www.ipo.gov.uk/tmtext?textquery=${encodeURIComponent(appNum)}` : searchUrl,
              snippet: `UK IPO Trademark${appNum ? ` | Application: ${appNum}` : ''}`,
              raw: { name: markName, applicationNumber: appNum, line: lines[i] }
            });
          }
        }
      }
    }
    
    // If pattern matching didn't work well, try a more general approach
    // Look for the search name in the content
    if (hits.length === 0) {
      const nameLower = name.toLowerCase();
      if (htmlContent.toLowerCase().includes(nameLower)) {
        // Found the name in content, but couldn't parse structure
        // Return a generic result
        hits.push({
          source: 'uk_ipo_web',
          title: name,
          url: searchUrl,
          snippet: `Found in UK IPO search results - check manually at ${searchUrl}`,
          raw: { note: 'Parsing incomplete - manual verification recommended' }
        });
      }
    }
    
    return { hits, data: { url: searchUrl, contentLength: htmlContent.length } };
  } catch (e) {
    return { error: e.message };
  }
}

async function trademarkSearchUKExpanded(name, opts = {}) {
  const key = `tm:${String(name || '').toLowerCase()}`;
  const ttlMs = (opts.ttlMinutes || 10) * 60 * 1000;
  const now = Date.now();
  const cached = trademarkCache.get(key);
  if (cached && (now - cached.ts) < ttlMs) return cached.value;

  const out = { summary: [], hits: [], warnings: [] };

  // 0) Direct API calls (highest priority - most accurate)
  // Try EUIPO API first (includes UK trademark data)
  try {
    const euipoRes = await searchEUIPOAPI(name, opts);
    if (!euipoRes.error && euipoRes.hits && euipoRes.hits.length > 0) {
      out.hits.push(...euipoRes.hits);
      out.summary.push(`EUIPO API: Found ${euipoRes.hits.length} trademark(s)`);
    } else if (euipoRes.error && !euipoRes.error.includes('not yet available')) {
      out.warnings.push(`EUIPO API: ${euipoRes.error}`);
    }
  } catch (e) {
    out.warnings.push(`EUIPO API error: ${String(e.message || e)}`);
  }

  // Try UK IPO (web scraping if enabled, or API if available in future)
  try {
    const ukIpoRes = await searchUKIPOAPI(name, opts);
    if (!ukIpoRes.error && ukIpoRes.hits && ukIpoRes.hits.length > 0) {
      out.hits.push(...ukIpoRes.hits);
      out.summary.push(`UK IPO: Found ${ukIpoRes.hits.length} trademark(s)`);
    } else if (ukIpoRes.error) {
      out.warnings.push(`UK IPO: ${ukIpoRes.error}`);
    } else if (ukIpoRes.info) {
      // Info message (e.g., web scraping disabled) - don't treat as error
      // Optionally log: out.warnings.push(`UK IPO: ${ukIpoRes.info}`);
    }
  } catch (e) {
    out.warnings.push(`UK IPO error: ${String(e.message || e)}`);
  }

  // 1) SerpAPI or Ollama webSearch expansion (if available)
  // By default perform a lightweight UK-focused trademark screen. To run broader
  // searches set opts.ukOnly = false when calling this function.
  const ukOnly = (typeof opts.ukOnly === 'boolean') ? opts.ukOnly : true;
  
    let queries = [];
    if (ukOnly) {
      // UK-focused queries: official IPO + commercial trademark databases (UK and international coverage)
      queries = [
      `"${name}" trademark site:ipo.gov.uk`,
      `"${name}" trademark site:gov.uk`,
      `"${name}" "trade mark" site:gov.uk`,
      `"${name}" site:trademarkia.com OR site:trademarknow.com OR site:wipo.int`
      ];
    } else {
      // Broader queries: official databases + commercial trademark search sites
      queries = [
      `"${name}" trademark site:ipo.gov.uk`,
      `"${name}" trademark site:euipo.europa.eu OR site:tmview.europa.eu`,
      `"${name}" trademark OR "trade mark"`,
      `"${name}" site:trademarkia.com OR site:trademarknow.com OR site:wipo.int OR site:uspto.gov`
    ];
  }

  // Prefer SerpAPI if available
  if (process.env.SERPAPI_KEY) {
    for (const q of queries) {
      try {
        const serpRes = await serpAPISearch(q, { maxResults: 8, ukOnly });
        if (!serpRes.error && serpRes.body?.organic_results) {
          for (const r of serpRes.body.organic_results) {
            out.hits.push({
              source: 'serpapi',
              query: q,
              title: r.title || '',
              url: r.link || '',
              snippet: r.snippet || '',
              raw: r,
            });
          }
        } else if (serpRes.error) {
          out.warnings.push(`SerpAPI query failed: ${serpRes.error}`);
        }
      } catch (e) {
        out.warnings.push(`SerpAPI query failed: ${String(e.message || e)}`);
      }
    }
  } else if (typeof ollama.webSearch === 'function') {
    // Fallback to Ollama webSearch
    for (const q of queries) {
      try {
        const res = await ollama.webSearch({ query: q, max_results: 8 });
        const items = res?.results || res?.items || res?.hits || res?.data || [];
        if (Array.isArray(items) && items.length > 0) {
          for (const r of items) {
            const title = r.title || r.name || (r.title && (r.title.text || r.title.value)) || '';
            const url = r.url || r.link || r.path || r.href || '';
            const snippet = r.snippet || r.excerpt || r.summary || r.description || '';
            out.hits.push({ source: 'websearch', query: q, title, url, snippet, raw: r });
          }
        } else {
          out.hits.push({ source: 'websearch', query: q, raw: res });
        }
      } catch (e) {
        out.warnings.push(`webSearch query failed: ${String(e.message || e)}`);
      }
    }
  } else {
    out.warnings.push('No search provider available (set SERPAPI_KEY or enable ollama.webSearch); skipping web search layer.');
  }

  // 2) WhoisXMLAPI (optional, if key provided)
  if (process.env.WHOISXMLAPI_KEY) {
    const w = await callWhoisXmlTrademark(name);
    if (w.error) out.warnings.push('WhoisXMLAPI trademark query failed: ' + w.error);
    else {
      out.hits.push({ source: 'whoisxml', body: w.body });
      out.summary.push('WhoisXMLAPI results included (requires API key).');
    }
  }

  // Deduplicate by url/title when possible
  const seen = new Set();
  out.hits = out.hits.filter(h => {
    const id = ((h.url || '') + '|' + (h.title || '')).toLowerCase();
    if (!id || id === '|') return true; // keep raw entries
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  trademarkCache.set(key, { ts: Date.now(), value: out });
  return out;
}

async function searchAndSuggestNames(title, description, bizShort, visualsArr, brandVals, opts = {}) {
  const count = Number.isInteger(opts.count) ? opts.count : 3;
  // Default to 2 words per name unless caller overrides
  const maxWords = Number.isInteger(opts.maxWords) ? opts.maxWords : 2;
  const temperature = (typeof opts.temperature === 'number') ? opts.temperature : 0;
  const format = opts.format || null;
  const exclude = Array.isArray(opts.exclude) ? opts.exclude.map(n => String(n).trim()).filter(Boolean) : [];
  const systemLines = [];
  systemLines.push('You are a highly creative naming assistant. Use only your internal knowledge and the provided context to produce bold, inventive, and memorable brand names. Prefer one- or two-word names with no punctuation or special characters (use letters only). CRITICAL: NEVER add suffixes like "Co", "Co.", "Company", "Inc", "LLC", "Ltd", "Design", "Studio", "Group", "Solutions", "Branding", "Branding Co", "Branding Co.", or any other business entity suffixes to the end of names. The name should stand alone without any suffix. Do NOT use words like "Branding", "Design", "Studio", "Group", "Solutions" as part of the name if they function as suffixes. Avoid common generic words and suffixes such as &, Co., Company, Design, Studio. Favor coined or compound names (examples: Emberly, Luminara, Hearthly) as these are easier to trademark and more likely to be domain-available. Ensure names are tasteful and professional. Do NOT perform web searches or call any tools.');
  systemLines.push(`Produce EXACTLY ${count} name${count===1? '':'s'}.`);
  // Strong, explicit instruction for single-line, no decoration
  if (count === 1) {
    if (format === 'title_and_reason') {
      systemLines.push('Return EXACTLY TWO NON-EMPTY LINES.');
      systemLines.push('Line 1: the creative name only (no numbering, bullets, punctuation, or surrounding quotes). Max words: ' + (maxWords || 'no limit') + '.');
      systemLines.push('Line 2: a single short sentence (no more than 20 words) explaining WHY this name suits the business. Do NOT include labels like "Name:" or "Why:". No extra text.');
    } else {
      systemLines.push('Return EXACTLY ONE LINE containing only the name. Do NOT include numbers, bullets, punctuation, markdown, bold, parentheses, or any extra text. No descriptions, rationale, or commentary.');
    }
  } else {
    systemLines.push('Output ONE name per line only. Do NOT include descriptions, rationale, or extra commentary.');
  }
  if (maxWords) systemLines.push(`Each name must be at most ${maxWords} words.`);
  // If caller provided names to avoid, instruct the model explicitly
  if (exclude.length > 0) {
    systemLines.push('Do NOT suggest or repeat any of the following exact names: ' + exclude.join(', ') + '.');
  }
  const msgs = [
    { role: 'system', content: systemLines.join(' ') },
    { role: 'user', content: `Business: "${bizShort}"\nIdea title: "${title}"\nDescription: "${description}"\nVisuals: ${visualsArr.join(', ')}\nBrand values: ${brandVals.join(', ')}` }
  ];
  // Call the model directly (no tools). We expect a short, deterministic reply.
  const resp = await ollama.chat({ model: defaultModel, messages: msgs, options: { temperature } });
  // Normalize and return textual content
  const content = resp?.message?.content ?? extractTextFromOllamaResult(resp);
  return content || '';
}

let names;
if (earlySuggestedNames && earlySuggestedNames.length > 0) {
  // Reuse early suggestion (from the All set step)
  names = earlySuggestedNames.slice(0,3);
} else {
  const nameText = await searchAndSuggestNames(selected.title, selected.description || '', shortBiz, visuals || [], brandValues || [], { count: 1, maxWords: 2, temperature: 0, format: 'title_and_reason' });
  // Parse the returned two-line (name + reason) format
  const lines = (nameText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let parsedName = lines[0] ? lines[0].replace(/^\d+\.\s*/, '').replace(/^["'`\*\s]+|["'`\*\s]+$/g, '').trim() : '';
  
  // Remove suffixes from parsed name
  const cleanSuffixes = (name) => {
    if (!name) return name;
    let cleaned = String(name).trim();
    // Remove "Branding Co" or "Branding Co." first (before removing just "Co")
    cleaned = cleaned.replace(/\s+Branding\s+Co\.?\s*$/i, '').trim();
    // Remove common suffixes (with space before)
    cleaned = cleaned.replace(/\s+(Co\.?|Company|Inc\.?|LLC|Ltd\.?|Design|Studio|Group|Solutions|Corp\.?|Corporation)\s*$/i, '').trim();
    // Remove standalone "Co" or "Co." at the end (catch any remaining)
    cleaned = cleaned.replace(/\s+Co\.?\s*$/i, '').trim();
    return cleaned;
  };
  parsedName = cleanSuffixes(parsedName);
  
  const parsedReason = lines[1] ? lines[1].replace(/^["'`\*\s]+|["'`\*\s]+$/g, '').trim() : '';
  names = [{ name: parsedName, rationale: parsedReason }];
}
if (!Array.isArray(names) || names.length < 1) {
  // final dump and exit
  if (process.env.OLLAMA_DEBUG === '1') {
    console.error('Final nameParsed value (debug):', nameParsed);
    console.error('Raw name output (first 400 chars):\n', nameText.slice(0, 400));
  } else {
    try {
      const dumpPath = `ollama-names-raw-${Date.now()}.txt`;
      fs.writeFileSync(dumpPath, nameText || '');
      console.error(`Expected at least 1 name but could not parse them. Raw name output saved to ./${dumpPath}. Set OLLAMA_DEBUG=1 to print more debug info.`);
    } catch (writeErr) {
      console.error('Additionally, failed to save raw name output to disk:', writeErr.message);
    }
  }
  throw new Error('Invalid names shape');
}

// Use the first suggested name (we requested a single short creative name).
const chosenName = names[0].name;
const chosenRationale = names[0].rationale || '';
const chosenInitial = (chosenName && chosenName.length) ? chosenName.trim().charAt(0).toUpperCase() : '';

// Ask user if they want to edit the prompt manually, or proceed with logo generation
const rlEdit = readline.createInterface({ input, output });
let editRaw = (await rlEdit.question('\nDo you want to edit this prompt manually? ')).trim();
rlEdit.close();

let finalLogoPrompt = logoPromptText;

if (editRaw && /^y/i.test(editRaw)) {
  // User wants to edit manually
  const rlManual = readline.createInterface({ input, output });
  console.log('\nPlease type your custom logo prompt (press Enter when done):');
  const manualPrompt = (await rlManual.question('> ')).trim();
  rlManual.close();
  
  if (manualPrompt) {
    finalLogoPrompt = manualPrompt;
    console.log('\nUsing your custom prompt for logo generation.');
  } else {
    console.log('\nNo custom prompt provided, using the original prompt.');
  }
}

// Helper function to convert HEX to approximate color name for better model recognition
function hexToColorName(hex) {
  if (!hex) return 'unknown';
  const h = hex.replace('#', '').toUpperCase();
  // Common color mappings
  const colorMap = {
    '000000': 'black', 'FFFFFF': 'white', 'FF0000': 'red', '00FF00': 'green', '0000FF': 'blue',
    'FFFF00': 'yellow', 'FF00FF': 'magenta', '00FFFF': 'cyan', 'FFA500': 'orange', '800080': 'purple',
    'FFC0CB': 'pink', 'A52A2A': 'brown', '808080': 'gray', 'FFD700': 'gold', 'C0C0C0': 'silver',
    '008000': 'dark green', '000080': 'navy blue', '800000': 'maroon', 'FF6347': 'tomato',
    '32CD32': 'lime green', '4169E1': 'royal blue', 'FF1493': 'deep pink', '00CED1': 'dark turquoise',
    'FF8C00': 'dark orange', '2E8B57': 'sea green', '4682B4': 'steel blue', 'DC143C': 'crimson',
    '8B008B': 'dark magenta', '556B2F': 'dark olive green', 'B8860B': 'dark goldenrod',
  };
  
  // Exact match
  if (colorMap[h]) return colorMap[h];
  
  // Parse RGB
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  
  // Approximate color name based on RGB values
  if (r > 200 && g < 100 && b < 100) return 'red';
  if (r < 100 && g > 200 && b < 100) return 'green';
  if (r < 100 && g < 100 && b > 200) return 'blue';
  if (r > 200 && g > 200 && b < 100) return 'yellow';
  if (r > 200 && g < 100 && b > 200) return 'magenta';
  if (r < 100 && g > 200 && b > 200) return 'cyan';
  if (r > 200 && g > 150 && b < 100) return 'orange';
  if (r > 150 && g < 100 && b > 150) return 'purple';
  if (r > 200 && g > 150 && b > 150) return 'pink';
  if (r < 150 && g < 150 && b < 150) return 'dark';
  if (r > 200 && g > 200 && b > 200) return 'light';
  if (r > 100 && g < 80 && b < 80) return 'dark red';
  if (r < 80 && g > 100 && b < 80) return 'dark green';
  if (r < 80 && g < 80 && b > 100) return 'dark blue';
  
  // Fallback: describe by RGB
  if (r > g && r > b) {
    if (g > b) return 'warm red-orange';
    return 'red';
  }
  if (g > r && g > b) {
    if (r > b) return 'yellow-green';
    return 'green';
  }
  if (b > r && b > g) {
    if (r > g) return 'purple-blue';
    return 'blue';
  }
  
  return 'neutral';
}

// Extract HEX codes from the prompt and enhance with color names
function enhancePromptWithColorNames(prompt, hexA, hexB) {
  if (!hexA || !hexB) return prompt;
  
  const colorNameA = hexToColorName(hexA);
  const colorNameB = hexToColorName(hexB);
  
  // Add explicit color instructions at the beginning of the prompt
  const colorInstruction = `Use ${colorNameA} color (${hexA}) as primary and ${colorNameB} color (${hexB}) as accent. `;
  
  // Enhance existing HEX mentions in the prompt
  let enhanced = prompt;
  
  // Replace or add color mentions to be more explicit
  if (enhanced.includes(hexA) || enhanced.includes(hexB)) {
    // Add color names near HEX codes
    enhanced = enhanced.replace(new RegExp(hexA, 'gi'), `${colorNameA} (${hexA})`);
    enhanced = enhanced.replace(new RegExp(hexB, 'gi'), `${colorNameB} (${hexB})`);
  } else {
    // Add color instruction at the start if not present
    enhanced = colorInstruction + enhanced;
  }
  
  // Ensure color instructions are prominent
  if (!enhanced.toLowerCase().includes('primary') && !enhanced.toLowerCase().includes('accent')) {
    enhanced = colorInstruction + enhanced;
  }
  
  return enhanced;
}

// Extract HEX codes from paletteColorDetails if available
let hexAForFlux = null;
let hexBForFlux = null;
if (Array.isArray(paletteColorDetails) && paletteColorDetails[0]) {
  hexAForFlux = paletteColorDetails[0].hex1 || null;
  hexBForFlux = paletteColorDetails[0].hex2 || null;
} else if (Array.isArray(paletteColors) && paletteColors[0]) {
  try {
    const p = paletteColors[0].split('-')[0].trim();
    const parts = p.split(',').map(s => s.trim());
    if (parts[0]) hexAForFlux = parts[0];
    if (parts[1]) hexBForFlux = parts[1];
    } catch (e) {
    // ignore
  }
}

// Enhance the prompt with color names before sending to Flux
if (hexAForFlux && hexBForFlux) {
  // Ensure HEX codes have # prefix
  const hexAClean = hexAForFlux.startsWith('#') ? hexAForFlux.toUpperCase() : '#' + hexAForFlux.toUpperCase();
  const hexBClean = hexBForFlux.startsWith('#') ? hexBForFlux.toUpperCase() : '#' + hexBForFlux.toUpperCase();
  finalLogoPrompt = enhancePromptWithColorNames(finalLogoPrompt, hexAClean, hexBClean);
  console.log(`\nEnhanced prompt with colors: ${hexToColorName(hexAClean)} (${hexAClean}) and ${hexToColorName(hexBClean)} (${hexBClean})`);
}

// Perform visual similarity check using reverse image search
async function performVisualSimilarityCheck(imageUrl) {
  console.log('\n🔍 Running visual similarity check...');
  
  try {
    const imgRes = await serpAPIImageSearch(imageUrl, { ukOnly: false });
    
    if (imgRes.error) {
      console.warn('Visual similarity check failed:', imgRes.error);
      return;
    }
    
    if (!imgRes.body) {
      console.log('No visual similarity results found.');
      return;
    }
    
    // Get visual matches from Google Lens results
    const visualMatches = imgRes.body?.visual_matches || [];
    
    if (visualMatches.length === 0) {
      console.log('✅ No visually similar logos found in search results.');
      console.log('\n⚠️  DISCLAIMER: This visual similarity check is not a legal trademark clearance.');
      console.log('   It only searches for visually similar images and does not check official trademark databases.');
      return;
    }
    
    // Filter for trademark-related results
    const trademarkRelated = visualMatches.filter(match => {
      const title = (match.title || '').toLowerCase();
      const url = (match.link || '').toLowerCase();
      const source = (match.source || '').toLowerCase();
      const combined = title + ' ' + url + ' ' + source;
      
      // Check for trademark-related keywords
      return combined.includes('trademark') ||
             combined.includes('trade mark') ||
             combined.includes('ipo.gov.uk') ||
             combined.includes('trademark database') ||
             combined.includes('registered mark') ||
             combined.includes('logo') && (combined.includes('brand') || combined.includes('company'));
    });
    
    // Display results
    console.log(`\n📊 Visual Similarity Check Results:`);
    console.log(`   Found ${visualMatches.length} visually similar image(s) in search results.`);
    
    if (trademarkRelated.length > 0) {
      console.log(`\n   ⚠️  ${trademarkRelated.length} result(s) appear to be trademark-related:`);
      trademarkRelated.slice(0, 5).forEach((match, idx) => {
        const title = match.title || 'No title';
        const url = match.link || '';
        const source = match.source || '';
        console.log(`   ${idx + 1}) ${title}`);
        if (source) console.log(`      Source: ${source}`);
        if (url) console.log(`      URL: ${url}`);
      });
} else {
      console.log(`\n   ℹ️  None of the similar images appear to be from trademark databases.`);
    }
    
    // Show top 3 most relevant matches (even if not trademark-related)
    if (visualMatches.length > 0 && trademarkRelated.length === 0) {
      console.log(`\n   Top similar images found:`);
      visualMatches.slice(0, 3).forEach((match, idx) => {
        const title = match.title || 'No title';
        const source = match.source || '';
        console.log(`   ${idx + 1}) ${title}${source ? ' - ' + source : ''}`);
      });
    }
    
    // Important disclaimers
    console.log('\n⚠️  IMPORTANT DISCLAIMERS:');
    console.log('   • This is a VISUAL SIMILARITY CHECK only, not a legal trademark clearance.');
    console.log('   • Similar visual appearance does not necessarily indicate a trademark conflict.');
    console.log('   • Trademark conflicts depend on industry, context, and registration classes.');
    console.log('   • This check does not search official trademark databases comprehensively.');
    console.log('   • Consult a trademark attorney for proper legal clearance before commercial use.');
    console.log('   • Even if no similar logos are found, other trademarks may still exist.');
    
  } catch (err) {
    console.warn('Visual similarity check encountered an error:', err.message);
    console.log('You may want to manually check for similar logos before using this design.');
  }
}

// Generate logo using FLUX.1 [dev] model via Gradio client
console.log('\nGenerating logo image using FLUX.1 [dev]...');
try {
  // Connect to FLUX.1-dev Gradio client
  const client = await Client.connect("black-forest-labs/FLUX.1-dev");
  
  // Generate image with the enhanced logo prompt
  const result = await client.predict("/infer", {
    prompt: finalLogoPrompt,
    seed: 0,
    randomize_seed: true,
    width: 1024,  // Higher resolution for logo
    height: 1024,
    guidance_scale: 3.5,  // Standard guidance scale for FLUX
    num_inference_steps: 28,  // Standard steps for quality
  });
  
  console.log('\nFLUX.1 [dev] generation completed.');
  
  // Handle the response - Gradio returns an array with file info object and metadata
  if (result && result.data && Array.isArray(result.data) && result.data.length > 0) {
    const fileInfo = result.data[0];
    
    // Check if it's a Gradio FileData object with a URL
    if (fileInfo && typeof fileInfo === 'object' && fileInfo.url) {
      const imageUrl = fileInfo.url;
      const fileExtension = fileInfo.orig_name?.split('.').pop() || 'webp';
      
      console.log(`\nImage generated at: ${imageUrl}`);
      
      try {
        // Download the image from the URL
        const imageResp = await fetch(imageUrl);
        if (!imageResp.ok) {
          throw new Error(`HTTP ${imageResp.status}: ${imageResp.statusText}`);
        }
        
        const imageBuffer = Buffer.from(await imageResp.arrayBuffer());
        
        // Convert to PNG if sharp is available, otherwise save as WebP
        let imagePath;
        try {
          // Try to use sharp for PNG conversion
          const sharpModule = await import('sharp');
          const sharp = sharpModule.default;
          const pngBuffer = await sharp(imageBuffer).png().toBuffer();
          imagePath = `logo-${Date.now()}.png`;
          fs.writeFileSync(imagePath, pngBuffer);
          console.log(`\n✅ Logo saved as PNG to: ./${imagePath}`);
          
          // Run visual similarity check using reverse image search
          if (process.env.SERPAPI_KEY && imageUrl) {
            await performVisualSimilarityCheck(imageUrl);
          }
        } catch (sharpErr) {
          // Fallback: save as original format (WebP) if sharp is not available
          imagePath = `logo-${Date.now()}.${fileExtension}`;
          fs.writeFileSync(imagePath, imageBuffer);
          console.log(`\n✅ Logo saved to: ./${imagePath} (WebP format - install 'sharp' package for PNG conversion)`);
          
          // Run visual similarity check using reverse image search
          if (process.env.SERPAPI_KEY && imageUrl) {
            await performVisualSimilarityCheck(imageUrl);
          }
        }
      } catch (downloadErr) {
        console.warn('Failed to download image from URL:', downloadErr.message);
        console.log(`\nYou can download it manually from: ${imageUrl}`);
      }
    } else if (typeof fileInfo === 'string') {
      // Fallback: if it's a direct URL string
      if (fileInfo.startsWith('http://') || fileInfo.startsWith('https://')) {
        try {
          const imageResp = await fetch(fileInfo);
          const imageBuffer = Buffer.from(await imageResp.arrayBuffer());
          
          // Convert to PNG if sharp is available
          let imagePath;
          try {
            const sharpModule = await import('sharp');
            const sharp = sharpModule.default;
            const pngBuffer = await sharp(imageBuffer).png().toBuffer();
            imagePath = `logo-${Date.now()}.png`;
            fs.writeFileSync(imagePath, pngBuffer);
            console.log(`\n✅ Logo saved as PNG to: ./${imagePath}`);
          } catch (sharpErr) {
            // Fallback: save as WebP
            imagePath = `logo-${Date.now()}.webp`;
            fs.writeFileSync(imagePath, imageBuffer);
            console.log(`\n✅ Logo saved to: ./${imagePath} (WebP format - install 'sharp' package for PNG conversion)`);
          }
          
          // Run visual similarity check using reverse image search
          if (process.env.SERPAPI_KEY && fileInfo) {
            await performVisualSimilarityCheck(fileInfo);
          }
        } catch (downloadErr) {
          console.warn('Failed to download image:', downloadErr.message);
        }
      }
    } else {
      // Log the response structure for debugging
      console.warn('Unexpected response format. File info:', JSON.stringify(fileInfo, null, 2));
    }
  } else {
    console.warn('No image data in response. Full result:', JSON.stringify(result, null, 2).substring(0, 500));
    }
  } catch (fluxErr) {
  console.warn('FLUX.1 [dev] generation failed:', fluxErr.message || fluxErr);
  if (fluxErr.stack) {
    console.warn('Error details:', fluxErr.stack);
  }
}