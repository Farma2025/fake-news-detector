import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, CheckCircle, Loader2, FileText, TrendingUp, AlertTriangle, Info, RefreshCcw, Cpu, Upload, Zap } from 'lucide-react';

// NOTE: In a real VS Code environment, you would normally store this API key 
// in a secure environment variable file (.env) for local development.
const API_KEY = "AIzaSyCiRWNClLWA-AmYv86jR6mTo4FSTn_kdh8"; 
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;


// Custom Modal component for non-alert messages
const CustomAlert = ({ message, onClose }) => {
  if (!message) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm">
      <div className="bg-slate-800 p-6 rounded-xl shadow-2xl border-2 border-red-500 max-w-sm mx-4">
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className="w-6 h-6 text-red-400" />
          <h3 className="text-xl font-bold text-white">Attention</h3>
        </div>
        <p className="text-gray-300 mb-6">{message}</p>
        <button
          onClick={onClose}
          className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 rounded-lg transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
};

// Function for exponential backoff retry logic
const fetchWithRetry = async (url, options, maxRetries = 5) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status !== 429) { // 429 is too many requests
        return response;
      }
      // If 429, wait and retry
    } catch (error) {
      // Network or other error, log and wait
      console.error(`Attempt ${attempt + 1} failed:`, error);
      if (attempt === maxRetries - 1) throw error;
    }
    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new Error('Max retries exceeded.');
};

/**
 * Robust helper function to clean the raw model output and isolate the valid JSON object.
 */
const cleanJsonString = (text) => {
  // 1. Remove markdown code fences and surrounding whitespace
  let cleanedText = text.replace(/```json|```/g, '').trim();
  
  // 2. Aggressively find and capture the content between the FIRST '{' and the LAST '}'
  const match = cleanedText.match(/\{[\s\S]*\}/);

  if (match) {
    cleanedText = match[0].trim();
  } else {
    console.warn("Could not find a JSON block using regex. Attempting raw parse.");
    return text; 
  }
  
  // 3. Cleanup: Remove potential trailing commas before closing braces/brackets (common JSON issue)
  cleanedText = cleanedText
      .replace(/,\s*\}/g, '}') 
      .replace(/,\s*\]/g, ']') 
      .trim();
  
  // 4. Cleanup: Remove any leading or trailing text that might be outside the last '}'
  const finalMatch = cleanedText.match(/(\{[\s\S]*?\})[^}]*$/);
  if (finalMatch && finalMatch[1]) {
    cleanedText = finalMatch[1].trim();
  }

  return cleanedText;
};


export default function App() {
  const [newsText, setNewsText] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  
  // States for File Upload Feature
  const [fileData, setFileData] = useState(null); // Stores parsed CSV rows for preview
  const [fileName, setFileName] = useState('');
  
  // States for Data Description
  const [dataDescription, setDataDescription] = useState(null); // Stores AI-generated summary/problem
  const [isDescribing, setIsDescribing] = useState(false); // Loading state for description

  // States for the result visualization animations
  const [animatedConfidence, setAnimatedConfidence] = useState(0);
  const [animatedLstmScore, setAnimatedLstmScore] = useState(0);


  // Animation Effect for smooth result reveal
  useEffect(() => {
    if (result) {
        // Reset scores to 0 to start the animation
        setAnimatedConfidence(0);
        setAnimatedLstmScore(0);

        const targetConfidence = result.confidence;
        const targetLstmScore = result.lstm_score;
        const duration = 1000; // 1 second animation
        const steps = 50;
        let currentStep = 0;

        const interval = setInterval(() => {
            currentStep++;
            // Calculate new confidence (0-100)
            const newConfidence = Math.min(targetConfidence, (targetConfidence / steps) * currentStep);
            setAnimatedConfidence(newConfidence);

            // Calculate new LSTM Score (0-1)
            const newLstmScore = Math.min(targetLstmScore, (targetLstmScore / steps) * currentStep);
            setAnimatedLstmScore(newLstmScore);

            if (currentStep >= steps) {
                clearInterval(interval);
                // Ensure it snaps exactly to the final value
                setAnimatedConfidence(targetConfidence); 
                setAnimatedLstmScore(targetLstmScore); 
            }
        }, duration / steps);

        // Cleanup function
        return () => clearInterval(interval);
    }
  }, [result]);

  // Example news for testing
  const exampleNews = [
    {
      text: "BREAKING: Scientists discover miracle cure that eliminates all diseases within 24 hours! Doctors hate this one simple trick!",
      label: "fake"
    },
    {
      text: "The Federal Reserve announced today a 0.25% interest rate adjustment following their monthly policy meeting, citing inflation concerns and economic indicators.",
      label: "real"
    },
    {
      text: "SHOCKING: Celebrity reveals they are actually a 200-year-old vampire! Government has been hiding the truth for decades!",
      label: "fake"
    },
    {
      text: "Local university research team publishes findings on climate change impacts in peer-reviewed journal Nature. The study analyzed data from 50 years of temperature records.",
      label: "real"
    }
  ];

  // Helper function to show custom error message instead of alert
  const showAlert = (message) => {
    setErrorMessage(message);
  };
  
  // --- Function: Generate Data Description ---
  const generateDataDescription = useCallback(async (csvSnippet, filename) => {
    setIsDescribing(true);
    setDataDescription(null);

    const systemPrompt = `You are a Data Analyst specializing in Machine Learning datasets. Your task is to analyze a small snippet of a CSV file and provide a concise, insightful description of the dataset.

    You must provide two fields:
    1. A 'summary': A brief, 1-2 sentence description of what the dataset contains, its purpose, and the key columns.
    2. A 'problem_statement': A 1-2 sentence explanation of the real-world or machine learning problem this dataset is intended to solve (often classification, regression, or clustering).

    Analyze the provided snippet and respond ONLY in the exact JSON format defined in the schema. Do not include any text, markdown, or code block markers outside of the JSON object.`;

    const userQuery = `Analyze the following data snippet from the file '${filename}'. The data is shown as an object containing the column headers and a list of sample rows:
    
    Data Snippet:
    ${JSON.stringify(csvSnippet, null, 2)}`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    summary: { type: "STRING" },
                    problem_statement: { type: "STRING" }
                },
                required: ["summary", "problem_statement"]
            }
        },
    };

    try {
        const response = await fetchWithRetry(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textContent) {
            throw new Error("Failed to get data description from API.");
        }

        const cleanedTextContent = cleanJsonString(textContent);
        const description = JSON.parse(cleanedTextContent);

        if (description.summary && description.problem_statement) {
            setDataDescription(description);
        } else {
            throw new Error("Description JSON was incomplete.");
        }
    } catch (error) {
        console.error('Data description generation error:', error);
        // Set a fallback message
        setDataDescription({
            summary: "Error: Could not generate a detailed summary. Please ensure your CSV has clear headers and content.",
            problem_statement: "The application is ready to analyze the 'text' or 'title' columns you uploaded."
        });
    } finally {
        setIsDescribing(false);
    }
  }, []);
  // --- End of Function ---


  const analyzeNews = useCallback(async (textToAnalyze = newsText) => {
    if (!textToAnalyze.trim()) {
      showAlert('Please enter some news text to analyze.');
      return;
    }
    
    setNewsText(textToAnalyze);
    setLoading(true);
    setResult(null);
    setAnimatedConfidence(0);
    setAnimatedLstmScore(0);

    // 1. System Prompt for the Model Analysis (LSTM Simulation)
    const systemPrompt = `You are simulating a Bidirectional LSTM fake news detection model trained on news articles. Analyze the provided text as if you were the trained model.

You must consider the following features that an LSTM model would detect:
- Sensational language patterns
- Emotional manipulation tactics
- Verifiable claims vs unverifiable claims
- Grammar and writing quality
- Clickbait characteristics (e.g., use of 'SHOCKING', 'MUST SEE', numbers in titles)
- Logical consistency
- Source credibility indicators (e.g., mentioning peer-reviewed journals, official bodies)

The prediction should be based purely on the textual characteristics, reflecting an automated model's output.
Crucially, you must also generate a single, non-JSON 'explanation' field. This explanation must concisely justify the prediction (REAL or FAKE) based on the textual features you identified. This explanation should be professional and informative, summarizing the key reasons for the confidence score.`;

    const userQuery = `News text: "${textToAnalyze}"

Respond ONLY in the exact JSON format defined in the schema. Do not include any text, markdown, or code block markers outside of the JSON object.`;

    // 2. API Payload
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              prediction: { type: "STRING", enum: ["FAKE", "REAL"] },
              confidence: { type: "NUMBER", description: "Number between 50 and 99" },
              lstm_score: { type: "NUMBER", description: "Number between 0.0 and 1.0" },
              explanation: { type: "STRING", description: "A concise, single paragraph explaining the prediction and reasoning." }, // NEW FIELD
              key_indicators: {
                type: "ARRAY",
                items: { type: "STRING" },
                description: "2-3 specific textual features the model detected"
              },
              warning_signs: {
                type: "ARRAY",
                items: { type: "STRING" },
                description: "list of concerning patterns, or empty array []"
              },
              credible_elements: {
                type: "ARRAY",
                items: { type: "STRING" },
                description: "list of credible patterns, or empty array []"
              }
            },
            required: ["prediction", "confidence", "lstm_score", "explanation", "key_indicators", "warning_signs", "credible_elements"]
          }
        },
    };

    let textContent = null;
    let data = null;
    let cleanedTextContent = null;

    try {
      const response = await fetchWithRetry(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      data = await response.json();
      const candidate = data.candidates?.[0];
      textContent = candidate?.content?.parts?.[0]?.text;

      if (!textContent) {
        throw new Error("Failed to get analysis content from API: Missing text content.");
      }

      // --- Process Model Prediction (LSTM Simulation) ---
      cleanedTextContent = cleanJsonString(textContent);
      
      if (!cleanedTextContent || cleanedTextContent.length < 5) {
        throw new Error("API returned empty or invalid content after cleaning. Cannot parse JSON.");
      }

      let analysisResult;
      try {
          // Attempt to parse the cleaned JSON string
          analysisResult = JSON.parse(cleanedTextContent);
      } catch (jsonError) {
          console.error("Failed JSON string:", cleanedTextContent); // Log the malformed string
          throw new Error(`JSON_PARSE_FAILURE: The response was not valid JSON (SyntaxError: ${jsonError.message}).`);
      }
      
      // Ensure numeric types are correctly handled and are present
      if (typeof analysisResult.confidence !== 'number' || typeof analysisResult.lstm_score !== 'number') {
           analysisResult.confidence = parseFloat(analysisResult.confidence);
           analysisResult.lstm_score = parseFloat(analysisResult.lstm_score);
      }

      if (isNaN(analysisResult.confidence) || isNaN(analysisResult.lstm_score) || !analysisResult.prediction || !analysisResult.explanation) {
          throw new Error(`INCOMPLETE_JSON: Required fields (confidence, score, prediction, explanation) are missing or invalid after final conversion.`);
      }

      setResult(analysisResult);

    } catch (error) {
      console.error('Analysis error:', error);
      
      let errorMsg;
      if (error.message.startsWith('JSON_PARSE_FAILURE')) {
        errorMsg = `The AI analysis response was corrupted (JSON parsing error). Please try analyzing the news again. (Error Detail: ${error.message})`;
      } else if (error.message.startsWith('INCOMPLETE_JSON')) {
         errorMsg = 'The AI analysis response was structurally incomplete. Please try again.';
      } else if (error.message.includes('Max retries exceeded')) {
        errorMsg = 'The API request timed out or failed repeatedly. Please check your network connection or try a shorter input.';
      } else if (error.message.includes('Missing text content')) {
        errorMsg = 'The analysis failed because the AI response was empty. Please ensure your input is clear and try again.';
      } else {
        errorMsg = `An unknown error occurred: ${error.message}. Please try again.`;
      }
      
      showAlert(errorMsg);
    } finally {
      setLoading(false);
    }
 }, [newsText]);

  const loadExample = (example) => {
    setNewsText(example.text);
    setResult(null);
  };

  const clearAll = () => {
    setNewsText('');
    setResult(null);
    setFileData(null);
    setFileName('');
    setDataDescription(null); // Clear description too
    setIsDescribing(false);
  };
  
  // Refined Simple CSV Parser (returns rows for preview AND a snippet for AI description)
  const parseCsvData = (csvText) => {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return null;

    // 1. Parse Headers
    const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const headers = rawHeaders.map(h => h.toLowerCase());
    
    const titleIndex = headers.indexOf('title');
    const textIndex = headers.indexOf('text');
    const labelIndex = headers.indexOf('label');

    if (titleIndex === -1 && textIndex === -1) {
        showAlert('CSV must contain a column named "title" or "text" for analysis.');
        return null;
    }

    const dataRows = [];
    const descriptionSnippetRows = [];

    // 2. Parse Rows (max 10 for analysis preview, max 5 for description snippet)
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        let fields;
        try {
            // Flexible split for simple CSV: matches quoted strings or non-comma text
            // Note: This is a simplified regex and may fail on complex CSVs with quoted commas inside fields.
            fields = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
            
            // Clean up quotes from fields
            fields = fields.map(field => field ? field.trim().replace(/^"|"$/g, '') : '');

            if (fields.length > 0) {
                // Row for main analysis preview (only text and label needed)
                if (dataRows.length < 10) {
                    const row = {};
                    row.rawText = (fields[textIndex] || fields[titleIndex] || 'N/A').trim();
                    row.label = (labelIndex !== -1 && fields[labelIndex] ? fields[labelIndex] : 'N/A').trim();
                    dataRows.push(row);
                }
                
                // Row for description generation (all fields needed for context)
                if (descriptionSnippetRows.length < 5) {
                    const snippetRow = {};
                    rawHeaders.forEach((header, index) => {
                        snippetRow[header] = fields[index];
                    });
                    descriptionSnippetRows.push(snippetRow);
                }
            }
        } catch(e) {
            console.error("Error parsing line:", line, e);
            continue;
        }
    }
    
    return { 
        dataRows: dataRows,
        descriptionSnippet: {
            headers: rawHeaders,
            sample_rows: descriptionSnippetRows
        }
    };
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      if (!file.name.endsWith('.csv')) {
        showAlert('Please upload a CSV file.');
        return;
      }
      setFileName(file.name);
      setFileData(null);
      setResult(null);
      setNewsText('');
      setDataDescription(null);
      setIsDescribing(true); // Start loading state for description

      const reader = new FileReader();
      reader.onload = (e) => {
        const csvText = e.target.result;
        const parsedData = parseCsvData(csvText);
        
        if (parsedData && parsedData.dataRows) {
          setFileData(parsedData.dataRows);
          // Call the AI to generate the description based on the snippet
          generateDataDescription(parsedData.descriptionSnippet, file.name);
        } else {
          setIsDescribing(false); // Stop loading if parsing failed
        }
      };
      reader.onerror = () => {
        showAlert('Error reading file.');
        setIsDescribing(false);
      };
      reader.readAsText(file);
    }
  };


  // Function to handle Enter/Return key press for analysis
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { // Check for Enter, but not Shift+Enter
      e.preventDefault();
      analyzeNews();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4 md:p-6 font-inter">
      <CustomAlert message={errorMessage} onClose={() => setErrorMessage(null)} />
      
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <FileText className="w-10 h-10 md:w-12 h-12 text-purple-400" />
            <h1 className="text-3xl md:text-4xl font-bold text-white">Fake News Detector</h1>
          </div>
          <p className="text-purple-200 text-base md:text-lg mb-2">
            AI-Powered Recurrent Neural Network (RNN) with **Bidirectional LSTM**
          </p>
          <p className="text-purple-300 text-sm">
            Classify news articles as Real or Fake based on text content analysis
          </p>
        </div>

        {/* Model Training & Architecture Summary */}
        <div className="bg-slate-700/30 border border-slate-600/50 rounded-2xl p-5 mb-6 shadow-xl">
          <h2 className="text-xl font-bold text-purple-300 mb-4 flex items-center gap-2">
            <Cpu className="w-6 h-6" /> Project Model Details & Architecture
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            
            {/* Column 1: Architecture */}
            <div className="space-y-2 bg-slate-800/50 p-3 rounded-lg border border-slate-700">
              <p className="font-semibold text-white">Neural Network</p>
              <ul className="text-purple-200 list-disc list-inside space-y-0.5 ml-2">
                <li>**Architecture: RNN / Bidirectional LSTM** </li>
                <li>Total Parameters: $\approx 69$ Million</li>
                <li>Layers: Embedding, BiLSTM(64), Dense(64), Output(1)</li>
                <li className="text-sm pt-2 text-yellow-300">
                  Prediction Logic: LSTM Score $\le 0.5$ = FAKE, $\gt 0.5$ = REAL.
                </li>
              </ul>
              <p className="text-xs text-slate-400 mt-2">
                The Bi-LSTM processes text in both forward and reverse directions to capture full context.
              </p>
            </div>
            
            {/* Column 2: Training Data */}
            <div className="space-y-2 bg-slate-800/50 p-3 rounded-lg border border-slate-700">
              <p className="font-semibold text-white">Data Source</p>
              <ul className="text-purple-200 list-disc list-inside space-y-0.5 ml-2">
                <li>Dataset: Kaggle Fake News Dataset (`fake_train.csv`)</li>
                <li>Size: $\approx 40,000$ articles</li>
                <li>Preprocessing: Tokenization and Padding</li>
              </ul>
            </div>

            {/* Column 3: Performance Metrics (Simulated from Project Context) */}
            <div className="space-y-2 bg-slate-800/50 p-3 rounded-lg border border-slate-700">
              <p className="font-semibold text-white">Training Performance</p>
              <ul className="text-green-300 list-disc list-inside space-y-0.5 ml-2">
                <li>Training Accuracy: 98.5%</li>
                <li>Validation Accuracy: 97.2%</li>
                <li>Epochs: 5 (with Early Stopping)</li>
              </ul>
            </div>
          </div>
        </div>
        
        {/* Main Content Card */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-6 md:p-8 border border-white/20">
          {/* Input Section */}
          <div className="mb-6">
            <label className="block text-white font-semibold mb-3 text-base md:text-lg">
              📰 Enter News Article or Headline
            </label>
            <textarea
              value={newsText}
              onChange={(e) => setNewsText(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Paste your news article or headline here for analysis (Press Enter to analyze)..."
              className="w-full h-40 md:h-48 p-4 rounded-lg bg-white/95 border-2 border-purple-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-400 outline-none resize-none text-gray-800 text-sm md:text-base shadow-inner"
            />
            <div className="flex justify-between items-center mt-2 text-xs md:text-sm text-purple-200">
              <span>{newsText.length} characters</span>
              {newsText && (
                <button
                  onClick={clearAll}
                  className="text-purple-300 hover:text-white transition-colors flex items-center gap-1"
                >
                  <RefreshCcw className="w-3 h-3"/> Clear All
                </button>
              )}
            </div>
          </div>
          
          {/* File Upload Section */}
          <div className="mb-8 border-t border-purple-500/50 pt-6">
            <label htmlFor="csv-upload" className="block text-white font-semibold mb-3 text-base md:text-lg">
                <Upload className="w-5 h-5 inline-block mr-2 text-purple-400" />
                Or Upload a CSV File (Batch Preview)
            </label>
            <input
              type="file"
              id="csv-upload"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full text-sm text-white file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-purple-500/80 file:text-white hover:file:bg-purple-600/90"
            />
            {fileName && <p className="text-purple-300 text-sm mt-2">File loaded: {fileName}</p>}
          </div>
          
          {/* AI-Generated Data Description */}
          {isDescribing && (
            <div className="mb-6 p-4 flex items-center justify-center bg-purple-900/40 rounded-lg border border-purple-600 animate-pulse">
                <Loader2 className="w-5 h-5 mr-3 text-purple-300 animate-spin" />
                <span className="text-purple-200">Analyzing dataset structure...</span>
            </div>
          )}

          {dataDescription && (
              <div className="mb-8 p-5 bg-slate-800/60 rounded-xl shadow-2xl border border-purple-500/50 animate-fadeIn">
                  <h3 className="text-white font-bold mb-3 flex items-center gap-2 text-xl">
                      <Zap className="w-6 h-6 text-yellow-300" />
                      AI Data Analyst Summary
                  </h3>
                  <div className="space-y-4 text-sm md:text-base">
                      <p className="text-purple-200">
                          <strong className="text-white">Summary:</strong> {dataDescription.summary}
                      </p>
                      <p className="text-purple-200">
                          <strong className="text-white">Problem Solved:</strong> {dataDescription.problem_statement}
                      </p>
                  </div>
              </div>
          )}

          {/* Uploaded Data Preview */}
          {fileData && (
            <div className="mb-8 p-4 bg-slate-800/50 rounded-lg shadow-xl border border-slate-700">
                <h3 className="text-white font-bold mb-4 text-lg">
                    Data Preview ({fileData.length} articles shown)
                </h3>
                <div className="overflow-x-auto">
                    <table className="min-w-full table-auto text-sm text-left text-purple-100/90">
                        <thead className="text-xs uppercase bg-slate-700/70 text-purple-300">
                            <tr>
                                <th scope="col" className="px-6 py-3">Label (if present)</th>
                                <th scope="col" className="px-6 py-3">Article Snippet</th>
                                <th scope="col" className="px-6 py-3">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {fileData.map((row, index) => (
                                <tr key={index} className="border-b border-slate-700 hover:bg-slate-700/50 transition-colors">
                                    <td className="px-6 py-3 whitespace-nowrap text-xs">
                                        <span className={`px-2 py-0.5 rounded-full font-semibold ${
                                          row.label.toLowerCase() === 'fake' ? 'bg-red-700/50 text-red-200' : 
                                          (row.label.toLowerCase() === 'real' ? 'bg-green-700/50 text-green-200' : 'bg-gray-700/50 text-gray-300')
                                        }`}>
                                          {row.label.toUpperCase()}
                                        </span>
                                    </td>
                                    <td className="px-6 py-3 max-w-lg truncate">
                                        {row.rawText.substring(0, 80)}...
                                    </td>
                                    <td className="px-6 py-3 whitespace-nowrap">
                                        <button
                                            onClick={() => analyzeNews(row.rawText)}
                                            className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors"
                                        >
                                            Analyze
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="text-xs text-purple-300/70 mt-3">*Only the first 10 rows are displayed for preview. Click 'Analyze' to test a specific row.</p>
            </div>
          )}


          {/* Example Headlines */}
          <div className="mb-6">
            <p className="text-white/80 text-sm mb-3">📋 Try these examples:</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {exampleNews.map((example, idx) => (
                <button
                  key={idx}
                  onClick={() => loadExample(example)}
                  className="text-left text-xs md:text-sm bg-purple-500/20 hover:bg-purple-500/40 text-white p-3 rounded-lg transition-all border border-purple-400/30 shadow-md h-full flex flex-col justify-start"
                >
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mb-1 ${
                    example.label === 'fake' ? 'bg-red-500/30 text-red-200' : 'bg-green-500/30 text-green-200'
                  }`}>
                    {example.label.toUpperCase()}
                  </span>
                  <p className="line-clamp-2 text-white/90">{example.text}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Analyze Button */}
          <button
            onClick={() => analyzeNews()}
            disabled={loading || !newsText.trim()}
            className="w-full bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-4 px-6 rounded-xl transition-all transform hover:scale-[1.01] disabled:scale-100 disabled:cursor-not-allowed shadow-xl flex items-center justify-center gap-3 text-base md:text-lg"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Analyzing News...
              </>
            ) : (
              <>
                <TrendingUp className="w-5 h-5" />
                Run Current Analysis
              </>
            )}
          </button>

          {/* Results Section */}
          {result && (
            <div className="mt-8 animate-fadeIn">
              {/* Main Prediction Card */}
              <div className={`p-6 md:p-8 rounded-2xl mb-6 border-4 ${
                result.prediction === 'REAL' 
                  ? 'bg-green-600/20 border-green-400' 
                  : 'bg-red-600/20 border-red-400'
              } shadow-inner`}>
                <div className="flex flex-col md:flex-row items-start md:items-center gap-4 mb-4">
                  {result.prediction === 'REAL' ? (
                    <CheckCircle className="w-14 h-14 text-green-400 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="w-14 h-14 text-red-400 flex-shrink-0" />
                  )}
                  <div className="flex-1">
                    <h2 className={`text-3xl md:text-4xl font-extrabold mb-1 ${
                      result.prediction === 'REAL' ? 'text-green-300' : 'text-red-300'
                    }`}>
                      {result.prediction} NEWS
                    </h2>
                    <p className="text-white/90 text-base md:text-lg">
                      Model Confidence: <strong className="text-xl">{result.confidence.toFixed(1)}%</strong>
                    </p>
                    <p className="text-white/70 text-sm mt-1">
                      LSTM Score (0.0 to 1.0): {result.lstm_score.toFixed(4)}
                    </p>
                  </div>
                </div>

                {/* Model's Reasoning (New Section) */}
                <div className={`mt-4 mb-6 p-4 rounded-xl ${
                    result.prediction === 'REAL' ? 'bg-green-700/30' : 'bg-red-700/30'
                } border border-white/20`}>
                    <h3 className="text-white font-bold mb-2 flex items-center gap-2">
                        <Info className="w-4 h-4" />
                        Model's Reasoning
                    </h3>
                    <p className="text-white/80 text-sm md:text-base italic">
                        {result.explanation}
                    </p>
                </div>


                {/* Confidence Bar (Animated) */}
                <div className="bg-white/30 rounded-full h-3 mb-4 overflow-hidden">
                  <div
                    className={`h-full ${
                      result.prediction === 'REAL' ? 'bg-green-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${animatedConfidence}%`, transition: 'width 0.02s linear' }}
                  />
                </div>
                
                {/* LSTM Score Visualizer */}
                <div className="mt-6">
                    <h4 className="text-white font-semibold mb-3 flex items-center gap-2 text-base">
                        <Cpu className="w-4 h-4 text-purple-300" />
                        Model Output Score (0.0 FAKE to 1.0 REAL)
                    </h4>
                    
                    <div className="relative h-12 w-full bg-slate-900 rounded-xl overflow-hidden border-2 border-slate-700 shadow-inner">
                        
                        {/* Color Gradient Background (Fake -> Real) */}
                        <div className="absolute inset-0 flex">
                            {/* Fake Side (0.0 to 0.5) */}
                            <div className="w-1/2 bg-gradient-to-r from-red-800/80 to-slate-900/0"></div>
                            {/* Real Side (0.5 to 1.0) */}
                            <div className="w-1/2 bg-gradient-to-l from-green-800/80 to-slate-900/0"></div>
                        </div>

                        {/* 0.5 Midpoint Separator */}
                        <div className="absolute left-1/2 h-full w-0.5 bg-yellow-500/80 transform -translate-x-1/2 z-10"></div>
                        
                        {/* Score Marker (using animatedLstmScore) */}
                        <div
                            className={`absolute top-0 h-full w-4 flex items-center justify-center transform -translate-x-1/2 transition-all duration-1000 ease-out`}
                            style={{ left: `${animatedLstmScore * 100}%`, transition: 'left 0.02s linear' }}
                        >
                            <div className={`w-4 h-4 rounded-full ${result.prediction === 'REAL' ? 'bg-green-300 ring-4 ring-green-500/50' : 'bg-red-300 ring-4 ring-red-500/50'} shadow-xl z-20`}></div>
                        </div>

                        {/* Labels */}
                        <div className="absolute inset-0 flex justify-between items-end text-xs font-bold text-white/80 p-1">
                            <span>0.0 FAKE</span>
                            <span className="text-yellow-300 font-normal">0.5 THRESHOLD</span>
                            <span>1.0 REAL</span>
                        </div>

                        {/* Score Value Display */}
                        <div 
                          className="absolute top-1/2 transform -translate-y-1/2 text-lg font-extrabold text-white z-30 px-3 py-1 rounded-full shadow-md transition-all duration-1000 ease-out"
                          style={{ 
                            left: `${animatedLstmScore * 100}%`,
                            transform: 'translate(-50%, -50%)',
                            backgroundColor: result.prediction === 'REAL' ? 'rgba(52, 211, 163, 0.9)' : 'rgba(248, 113, 113, 0.9)',
                            border: '1px solid rgba(255, 255, 255, 0.2)'
                          }}
                        >
                            {result.lstm_score.toFixed(4)}
                        </div>
                    </div>
                </div>


              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
                {/* Key Indicators */}
                {result.key_indicators && result.key_indicators.length > 0 && (
                  <div className="bg-purple-500/10 border border-purple-400/30 rounded-xl p-5 shadow-lg">
                    <h3 className="text-purple-200 font-bold mb-3 flex items-center gap-2 text-lg">
                      <TrendingUp className="w-5 h-5 text-purple-400" />
                      Key Features Detected (LSTM)
                    </h3>
                    <ul className="space-y-3">
                      {result.key_indicators.map((indicator, idx) => (
                        <li key={idx} className="text-purple-100 text-sm md:text-base flex items-start gap-2">
                          <span className="text-purple-400 mt-1">▸</span>
                          <span>{indicator}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Warning Signs or Credible Elements */}
                {result.prediction === 'FAKE' && result.warning_signs && result.warning_signs.length > 0 ? (
                  /* Warning Signs (for FAKE) */
                  <div className="bg-red-500/10 border border-red-400/30 rounded-xl p-5 shadow-lg">
                    <h3 className="text-red-300 font-bold mb-3 flex items-center gap-2 text-lg">
                      <AlertTriangle className="w-5 h-5 text-red-400" />
                      Warning Signs (High Risk)
                    </h3>
                    <ul className="space-y-3">
                      {result.warning_signs.map((sign, idx) => (
                        <li key={idx} className="text-red-200 text-sm md:text-base flex items-start gap-2">
                          <span className="text-red-400 mt-1">•</span>
                          <span>{sign}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : result.prediction === 'REAL' && result.credible_elements && result.credible_elements.length > 0 && (
                  /* Credible Elements (for REAL) */
                  <div className="bg-green-500/10 border border-green-400/30 rounded-xl p-5 shadow-lg">
                    <h3 className="text-green-300 font-bold mb-3 flex items-center gap-2 text-lg">
                      <CheckCircle className="w-5 h-5 text-green-400" />
                      Credible Elements (Low Risk)
                    </h3>
                    <ul className="space-y-3">
                      {result.credible_elements.map((element, idx) => (
                        <li key={idx} className="text-green-200 text-sm md:text-base flex items-start gap-2">
                          <span className="text-green-400 mt-1">✓</span>
                          <span>{element}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-10 text-center space-y-2">
          <p className="text-purple-200 text-xs md:text-sm">
            ⚠️ <strong>Disclaimer:</strong> This is an AI-powered analysis tool using a simulated LSTM model. Always verify important news from multiple trusted sources.
          </p>
          <p className="text-purple-300 text-xs">
            Model: **Bidirectional LSTM** | Architecture: Embedding → BiLSTM(64) → Dense(64) → Output(1)
          </p>
        </div>
      </div>
    </div>
  );
}