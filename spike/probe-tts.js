// Is Groq TTS still blocked on terms acceptance? A two-way comparison needs
// both sides alive. Findings block says 400 "requires terms acceptance".
import 'dotenv/config';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const TEXT = 'Thanks for coming in. Tell me a bit about yourself, in under two minutes.';

for (const model of ['canopylabs/orpheus-v1-english']) {
  const t0 = Date.now();
  try {
    const r = await groq.audio.speech.create({
      model,
      voice: 'autumn',
      input: TEXT,
      response_format: 'wav',
    });
    const buf = Buffer.from(await r.arrayBuffer());
    console.log(`${model}: OK  ${buf.length} bytes in ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`${model}: BLOCKED ${e.status} - ${e.message?.slice(0, 200)}`);
  }
}
