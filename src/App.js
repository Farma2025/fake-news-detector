import React, { useState } from "react";

function App() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleAnalyze = () => {
    if (!text.trim()) {
      alert("Please enter news text.");
      return;
    }

    setLoading(true);
    setResult(null);

    setTimeout(() => {
      const suspiciousWords = [
        "shocking",
        "you won’t believe",
        "breaking",
        "miracle",
        "secret",
        "exposed",
        "click here",
        "guaranteed",
        "cure",
        "conspiracy"
      ];

      const lowerText = text.toLowerCase();
      let score = 0;

      suspiciousWords.forEach((word) => {
        if (lowerText.includes(word)) score++;
      });

      const isFake = score >= 2;

      setResult({
        label: isFake ? "FAKE NEWS" : "REAL NEWS",
        confidence: isFake ? "88.2%" : "91.6%",
        reason: isFake
          ? "Detected sensational or misleading keywords commonly found in fake news."
          : "Text appears factual and lacks common fake news indicators."
      });

      setLoading(false);
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-800 to-purple-600 text-white flex justify-center items-center px-4">
      <div className="w-full max-w-3xl bg-white/10 backdrop-blur-xl p-6 rounded-2xl shadow-2xl">

        <h1 className="text-3xl font-bold text-center mb-2">
          📄 Fake News Detector
        </h1>

        <p className="text-center text-sm opacity-80 mb-6">
          Frontend-only Fake News Detection Demo
        </p>

        <textarea
          className="w-full p-4 rounded-lg text-black resize-none mb-4"
          rows="6"
          placeholder="Paste news article or headline here..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="w-full py-3 rounded-lg font-semibold bg-purple-700 hover:bg-purple-800 transition"
        >
          {loading ? "Analyzing..." : "Run Current Analysis"}
        </button>

        {result && (
          <div className="mt-6 bg-black/30 p-4 rounded-lg">
            <h2 className="text-xl font-bold">{result.label}</h2>
            <p className="mt-1">Confidence: {result.confidence}</p>
            <p className="text-sm opacity-80 mt-2">{result.reason}</p>
          </div>
        )}

        <p className="text-xs text-center mt-6 opacity-60">
          ⚠️ Demo mode. No backend AI connected.
        </p>
      </div>
    </div>
  );
}

export default App;
