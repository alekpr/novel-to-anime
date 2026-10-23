import { config as dotenv } from 'dotenv';
dotenv();

const apiKey = process.env.LLM_API_KEY;
const model = process.env.LLM_MODEL ?? 'gemini-2.0-flash';

const testText = `ส่วนที่ 1: บทที่ 2 — บทเรียนแรกของ GM\n【ติ๊ง! ผู้ท้าทาย 3 คนเข้าสู่มิติด้านมืด】\nลมยามสายพัดผ่านปากถ้ำ ใบไม้แห้งกลิ้งผ่านปลายเท้าของหลิวเชียงที่ยืนขวางทางออกอยู่เงียบๆ`;

const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    system_instruction: { parts: [{ text: 'You are a helpful assistant. Return JSON only.' }] },
    contents: [{ role: 'user', parts: [{ text: `Summarize this text in 1 sentence. Return: {"summary": "..."}\n\n${testText}` }] }],
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 100, temperature: 0.1 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
    ],
  }),
});
const json = await res.json();
console.log('status:', res.status);
console.log('promptFeedback:', JSON.stringify(json.promptFeedback));
console.log('finishReason:', json.candidates?.[0]?.finishReason);
console.log('text:', json.candidates?.[0]?.content?.parts?.[0]?.text?.slice(0, 200));
console.log('full response keys:', Object.keys(json));
