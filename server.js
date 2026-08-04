const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const API_KEY = process.env.ANTHROPIC_API_KEY;

app.get('/', (req, res) => {
  res.send('Cram flashcard backend is running.');
});

app.post('/generate-flashcards', async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({ error: 'Server is missing its API key. Set ANTHROPIC_API_KEY in Render.' });
    }

    const { mode, count, text, image } = req.body;

    if (!count || (mode === 'text' && !text) || (mode === 'photo' && !image)) {
      return res.status(400).json({ error: 'Missing notes to generate flashcards from.' });
    }

    let contentBlocks = [];
    if (mode === 'photo') {
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.base64 }
      });
      contentBlocks.push({
        type: 'text',
        text: `Read the notes/textbook content in this photo and generate exactly ${count} flashcards from it.`
      });
    } else {
      contentBlocks.push({
        type: 'text',
        text: `Generate exactly ${count} flashcards from these notes:\n\n${text}`
      });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: 'You are a study assistant that converts notes into concise exam flashcards. Respond with ONLY a raw JSON array, no markdown fences, no preamble, no explanation. Each element must be an object with exactly two keys: "q" (a short, clear question) and "a" (a short, direct answer, ideally under 20 words). Base every card strictly on the content given — do not invent facts not present in the source.',
        messages: [{ role: 'user', content: contentBlocks }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'The AI service failed to respond. Try again in a moment.' });
    }

    const data = await response.json();
    const textOut = (data.content || []).map(b => b.text || '').join('\n').trim();
    const cleaned = textOut.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        return res.status(502).json({ error: 'Could not understand the AI response. Try a clearer photo or shorter text.' });
      }
    }

    const flashcards = (Array.isArray(parsed) ? parsed : []).filter(c => c && c.q && c.a);
    if (flashcards.length === 0) {
      return res.status(502).json({ error: 'No flashcards came back. Try a clearer photo or shorter text.' });
    }

    res.json({ flashcards });

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Cram backend listening on port ${PORT}`);
});
